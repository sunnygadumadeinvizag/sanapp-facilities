import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { currentUser, listSsoUsers } from "@/lib/auth";
import { isPocOfFacility } from "@/lib/poc";
import {
  PDF_MAX_BYTES,
  SLOT_MAX_MINUTES,
  SLOT_MIN_MINUTES,
  fmtMin,
  istDateKey,
  istMinute,
  slotDurationMin,
  slotIndex,
} from "@/lib/ist";
import { effectiveMaxMinutes } from "@/lib/limits";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** Effective end day of a booking (multi-day support: "" means same day). */
function endDayOf(date: string, endDate: string): string {
  return endDate && endDate >= date ? endDate : date;
}

const BOOKING_LIST_SELECT = {
  id: true,
  batchId: true,
  type: true,
  status: true,
  date: true,
  endDate: true,
  startMin: true,
  endMin: true,
  purpose: true,
  pdfName: true,
  facility: {
    select: {
      id: true,
      name: true,
      building: { select: { id: true, name: true } },
    },
  },
  user: { select: { id: true, username: true, name: true } },
  forUser: { select: { id: true, username: true, name: true } },
  cancelledAt: true,
  cancelReason: true,
  cancelledBy: { select: { id: true, username: true, name: true } },
};

/** Raised inside a booking transaction when the slot conflicts — maps to HTTP 409. */
class SlotConflict extends Error {}

/** True when PostgreSQL rejected the write via the no-overlap exclusion constraint. */
function isExclusionViolation(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const code = (e as { code?: unknown }).code;
  const message = String((e as { message?: unknown }).message ?? "");
  return code === "P2004" || code === "23P01" || /exclusion|no_overlap/i.test(message);
}

async function hasConflict(
  client: { booking: typeof prisma.booking },
  facilityId: string,
  startDate: string,
  endDate: string,
  startMin: number,
  endMin: number,
  excludeId?: string
) {
  const startIdx = slotIndex(startDate, startMin);
  const endIdx = slotIndex(endDate, endMin);
  const overlapping = await client.booking.findMany({
    where: {
      facilityId,
      status: "CONFIRMED",
      NOT: excludeId ? { id: excludeId } : undefined,
    },
    select: { id: true, date: true, endDate: true, startMin: true, endMin: true },
  });
  for (const b of overlapping) {
    const bEnd = endDayOf(b.date, b.endDate);
    const bStartIdx = slotIndex(b.date, b.startMin);
    const bEndIdx = slotIndex(bEnd, b.endMin);
    if (startIdx < bEndIdx && endIdx > bStartIdx) return true;
  }
  return false;
}

export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) return bad("unauthorized", 401);

  const { searchParams } = new URL(request.url);
  const facilityId = searchParams.get("facilityId");
  const date = searchParams.get("date");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const mine = searchParams.get("mine") === "1";
  const all = searchParams.get("all") === "1";

  // List-view filters (mine/all): q = free-text search, status, booker userId,
  // buildingId, facilityId, and from/to as a start-date range.
  const q = (searchParams.get("q") ?? "").trim().toLowerCase();
  const status = searchParams.get("status") ?? "";
  const userId = searchParams.get("userId") ?? "";
  const buildingId = searchParams.get("buildingId") ?? "";
  const facilityFilter = searchParams.get("facilityId") ?? "";
  const dateFrom = searchParams.get("dateFrom") ?? "";
  const dateTo = searchParams.get("dateTo") ?? "";

  const listWhere: Record<string, unknown> = {};
  if (status === "CONFIRMED" || status === "CANCELLED") listWhere.status = status;
  if (userId) {
    // The admin user filter searches the SSO registry, so accept the local
    // id, the SSO id or the username and resolve to the local user.
    const local = await prisma.appUser.findFirst({
      where: { OR: [{ id: userId }, { ssoUserId: userId }, { username: userId }] },
      select: { id: true },
    });
    listWhere.userId = local?.id ?? "__no_user__";
  }
  if (facilityFilter) listWhere.facilityId = facilityFilter;
  if (buildingId) listWhere.facility = { buildingId };
  if (dateFrom && DATE_RE.test(dateFrom)) listWhere.date = { gte: dateFrom, ...(listWhere.date ?? {}) };
  if (dateTo && DATE_RE.test(dateTo)) {
    listWhere.date = { ...(listWhere.date ?? {}), lte: dateTo };
  }
  if (q) {
    const term = { contains: q, mode: "insensitive" as const };
    listWhere.OR = [
      { facility: { name: term } },
      { facility: { building: { name: term } } },
      { purpose: term },
      { user: { name: term } },
      { user: { username: term } },
      { forUser: { name: term } },
      { forUser: { username: term } },
    ];
  }

  if (all) {
    if (user.role !== "ADMIN") return bad("forbidden", 403);
    const rows = await prisma.booking.findMany({
      where: listWhere,
      orderBy: [{ date: "desc" }, { startMin: "desc" }],
      select: BOOKING_LIST_SELECT,
    });
    const bookings = rows.map(({ pdfName, ...rest }) => ({
      ...rest,
      endDate: endDayOf(rest.date, rest.endDate),
      pdf: Boolean(pdfName),
    }));
    return NextResponse.json({ bookings });
  }

  if (mine) {
    const rows = await prisma.booking.findMany({
      // listWhere (filters incl. free-text OR) AND the mine filter.
      where: { AND: [listWhere, { OR: [{ userId: user.id }, { forUserId: user.id }] }] },
      orderBy: [{ date: "asc" }, { startMin: "asc" }],
      select: BOOKING_LIST_SELECT,
    });
    const bookings = rows.map(({ pdfName, ...rest }) => ({
      ...rest,
      endDate: endDayOf(rest.date, rest.endDate),
      pdf: Boolean(pdfName),
    }));
    return NextResponse.json({ bookings });
  }

  if (!facilityId) return bad("facilityId is required");

  // Calendar range query: bookings overlapping [from, to] (both inclusive).
  if (from && to && DATE_RE.test(from) && DATE_RE.test(to)) {
    const rows = await prisma.booking.findMany({
      where: { facilityId, status: "CONFIRMED" },
      orderBy: [{ date: "asc" }, { startMin: "asc" }],
      select: BOOKING_LIST_SELECT,
    });
    const fromIdx = slotIndex(from, 0);
    const toIdx = slotIndex(to, 1440);
    const bookings = rows
      .filter((b) => {
        const bEnd = endDayOf(b.date, b.endDate);
        return slotIndex(b.date, b.startMin) < toIdx && slotIndex(bEnd, b.endMin) > fromIdx;
      })
      .map(({ pdfName, ...rest }) => ({
        ...rest,
        endDate: endDayOf(rest.date, rest.endDate),
        pdf: Boolean(pdfName),
      }));
    return NextResponse.json({ bookings });
  }

  // Single-day query (kept for compatibility): exact day.
  if (!date || !DATE_RE.test(date)) return bad("date (YYYY-MM-DD), from/to, or mine is required");
  const rows = await prisma.booking.findMany({
    where: { facilityId, date, status: "CONFIRMED" },
    orderBy: { startMin: "asc" },
    select: BOOKING_LIST_SELECT,
  });
  const bookings = rows.map(({ pdfName, ...rest }) => ({
    ...rest,
    endDate: endDayOf(rest.date, rest.endDate),
    pdf: Boolean(pdfName),
  }));
  return NextResponse.json({ bookings });
}

export async function POST(request: NextRequest) {
  const user = await currentUser();
  if (!user) return bad("unauthorized", 401);

  // Accept both plain JSON and multipart/form-data (the latter carries the
  // optional PDF attachment). Both forms carry the same fields.
  const ct = request.headers.get("content-type") ?? "";
  let body: Record<string, unknown> = {};
  let pdf: Buffer | null = null;
  let pdfName: string | null = null;

  if (ct.includes("multipart/form-data")) {
    const form = await request.formData();
    for (const key of ["facilityId", "date", "endDate", "startDate", "startMin", "endMin", "purpose", "forUserId", "batchId"]) {
      const v = form.get(key);
      if (v !== null && v !== undefined && typeof v === "string") body[key] = v;
    }
    const file = form.get("pdf");
    if (file && typeof file !== "string" && file.size > 0) {
      const bytes = Buffer.from(await file.arrayBuffer());
      const name = file.name || "";
      const type = file.type || "";
      if (bytes.length > PDF_MAX_BYTES) {
        return bad("PDF attachment must be 1 MB or smaller");
      }
      if (!name.toLowerCase().endsWith(".pdf") && type !== "application/pdf") {
        return bad("Attachment must be a PDF file");
      }
      pdf = bytes;
      pdfName = name;
    }
  } else {
    body = await request.json().catch(() => ({}));
  }

  const facilityId = String(body.facilityId ?? "").trim();
  const startDate = String(body.startDate ?? body.date ?? "").trim();
  let endDate = String(body.endDate ?? "").trim();
  const startMin = Number(body.startMin);
  const endMin = Number(body.endMin);
  const purpose = String(body.purpose ?? "").trim();
  const forUserId = String(body.forUserId ?? "").trim();
  const batchId = String(body.batchId ?? "").trim() || undefined;

  if (!facilityId || !startDate || !DATE_RE.test(startDate)) {
    return bad("facilityId and start date (YYYY-MM-DD) are required");
  }
  if (endDate && !DATE_RE.test(endDate)) {
    return bad("end date (YYYY-MM-DD) is invalid");
  }
  if (!endDate) endDate = startDate; // single-day booking
  if (endDate < startDate) {
    return bad("The end date cannot be before the start date");
  }
  if (!Number.isInteger(startMin) || !Number.isInteger(endMin) || startMin < 0 || endMin > 1440) {
    return bad("Invalid slot times");
  }

  const startIdx = slotIndex(startDate, startMin);
  const endIdx = slotIndex(endDate, endMin);
  if (endIdx <= startIdx) {
    return bad("The slot end must be after its start");
  }
  const duration = endIdx - startIdx;
  if (duration < SLOT_MIN_MINUTES) {
    return bad(`Minimum booking duration is ${SLOT_MIN_MINUTES} minutes`);
  }

  const facility = await prisma.facility.findUnique({
    where: { id: facilityId },
    include: { building: true, roleLimits: true },
  });
  if (!facility || !facility.active || !facility.building.active) {
    return bad("This facility is not available for booking");
  }

  // Booking type is derived from the duration:
  //   ≤ 3 hours  → SELF (any eligible user) or ON_BEHALF (POC, for another user)
  //   > 3 hours  → LONG (POC only, on their own name)
  // POC = POC of this facility OR of its building (or an app ADMIN).
  const pocHere = user.role === "ADMIN" || (await isPocOfFacility(user.id, facilityId));
  let type: "SELF" | "ON_BEHALF" | "LONG" = "SELF";
  if (duration > SLOT_MAX_MINUTES) {
    type = "LONG";
    if (!pocHere) {
      return bad(
        "Only the POC of this facility / building (or an app ADMIN) can book slots longer than 3 hours. Please ask a POC to book it for you.",
        403
      );
    }
    if (forUserId) {
      return bad("Long bookings (> 3 hours) are made on the booker's own name", 400);
    }
  } else {
    if (forUserId) {
      type = "ON_BEHALF";
      if (!pocHere) {
        return bad("Only a POC of this facility / building (or an app ADMIN) can block a slot for another user", 403);
      }
    }
  }

  // Eligibility — which SSO primary roles may book this facility.
  // ADMINs can book any facility regardless of their own primary role.
  // ON_BEHALF bookings check the FOR-user's eligibility, not the booker's.
  // The on-behalf picker sends the central SSO user id; resolve it to the
  // local app user and auto-provision a local row for users who have not
  // signed in to this app yet (their identity lives in the SSO registry).
  let resolvedForUserId: string | null = null;
  if (type === "ON_BEHALF" && forUserId) {
    let forUser = await prisma.appUser.findFirst({
      where: { OR: [{ ssoUserId: forUserId }, { id: forUserId }, { username: forUserId }] },
    });
    if (!forUser) {
      const ssoUsers = await listSsoUsers();
      const ssoUser = ssoUsers.find((u) => u.id === forUserId || u.username === forUserId);
      if (!ssoUser) return bad("The user this slot is being blocked for was not found", 400);
      forUser = await prisma.appUser.upsert({
        where: { username: ssoUser.username },
        update: {
          ssoUserId: ssoUser.id,
          name: ssoUser.name,
          email: ssoUser.email,
          primaryRole: ssoUser.primaryRole || null,
        },
        create: {
          ssoUserId: ssoUser.id,
          username: ssoUser.username,
          name: ssoUser.name,
          email: ssoUser.email,
          primaryRole: ssoUser.primaryRole || null,
          role: "USER",
        },
      });
    }
    resolvedForUserId = forUser.id;
  }

  if (facility.allowedRoles.length > 0 && user.role !== "ADMIN") {
    let eligibleRole: string | null = null;
    if (type === "ON_BEHALF" && resolvedForUserId) {
      const forUser = await prisma.appUser.findUnique({ where: { id: resolvedForUserId } });
      if (!forUser) return bad("The user this slot is being blocked for was not found", 400);
      eligibleRole = forUser.primaryRole ?? null;
    } else {
      eligibleRole = user.primaryRole;
    }
    if (!eligibleRole || !facility.allowedRoles.includes(eligibleRole)) {
      return bad(
        "This facility is restricted — your primary role is not in the allowed list. Contact the app administrator.",
        403
      );
    }
  }

  // --- Configurable maximum duration (building / facility / role caps) ---
  // For ON_BEHALF bookings the FOR-user's role limit applies (like eligibility).
  let capRole = user.primaryRole ?? null;
  if (type === "ON_BEHALF" && resolvedForUserId) {
    const forUser = await prisma.appUser.findUnique({ where: { id: resolvedForUserId } });
    capRole = forUser?.primaryRole ?? null;
  }
  const effMax = effectiveMaxMinutes(
    facility,
    facility.roleLimits.map((r) => ({ role: r.role, maxMinutes: r.maxMinutes })),
    capRole
  );
  if (effMax !== null && duration > effMax && user.role !== "ADMIN") {
    const fmtMax =
      effMax % 60 === 0
        ? `${effMax / 60} hour${effMax === 60 ? "" : "s"}`
        : `${effMax} minutes`;
    return bad(
      `The maximum booking duration for this facility is ${fmtMax}. Please pick a shorter range — or ask the app administrator to raise the limit.`
    );
  }

  // The slot must not be in the past (server time is IST).
  const nowIdx = slotIndex(istDateKey(), istMinute());
  if (startIdx <= nowIdx) {
    return bad("You cannot book a slot that has already started (times are Indian Standard Time)");
  }

  if ((type === "ON_BEHALF" || type === "LONG") && !purpose) {
    return bad("A description is required for this type of booking");
  }

  const CONFLICT_MSG =
    "That time range is already booked — please pick a free range in the calendar";
  let booking: Awaited<ReturnType<typeof prisma.booking.create>>;
  try {
    // Lock the facility row so concurrent booking attempts for the same
    // facility serialise — the conflict re-check and the insert are atomic,
    // so two users racing for the same (or overlapping) slot cannot both win.
    booking = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Facility" WHERE id = ${facilityId} FOR UPDATE`;
      if (await hasConflict(tx, facilityId, startDate, endDate, startMin, endMin)) {
        throw new SlotConflict(CONFLICT_MSG);
      }
      return await tx.booking.create({
        data: {
          facilityId,
          batchId,
          userId: user.id,
          forUserId: resolvedForUserId,
          type,
          status: "CONFIRMED",
          date: startDate,
          endDate,
          startMin,
          endMin,
          purpose: purpose || null,
          // Buffer -> Uint8Array<ArrayBuffer> for Prisma Bytes.
          pdf: pdf ? (() => { const b = new Uint8Array(pdf.byteLength); b.set(pdf); return b; })() : undefined,
          pdfName: pdfName ?? undefined,
        },
        include: {
          facility: { select: { id: true, name: true, building: { select: { id: true, name: true } } } },
          user: { select: { id: true, username: true, name: true } },
          forUser: { select: { id: true, username: true, name: true } },
        },
      });
    });
  } catch (e) {
    if (e instanceof SlotConflict || isExclusionViolation(e)) {
      return bad(CONFLICT_MSG, 409);
    }
    throw e;
  }

  return NextResponse.json(
    { booking, message: "Booking confirmed" },
    { status: 201 }
  );
}


/**
 * PATCH — edit a future booking: change the time range and/or description.
 * Allowed for the booker or an app ADMIN. Re-validates duration limits and
 * conflicts (ignoring this booking itself).
 */
export async function PATCH(request: NextRequest) {
  const user = await currentUser();
  if (!user) return bad("unauthorized", 401);

  // Accept both plain JSON and multipart/form-data (the latter carries an
  // optional replacement PDF). Both forms carry the same slot fields.
  const ct = request.headers.get("content-type") ?? "";
  let body: Record<string, unknown> = {};
  let pdf: Buffer | null = null;
  let pdfName: string | null = null;
  let pdfClear = false;
  if (ct.includes("multipart/form-data")) {
    const form = await request.formData();
    for (const key of ["id", "startDate", "endDate", "startMin", "endMin", "purpose"]) {
      const v = form.get(key);
      if (v !== null && v !== undefined && typeof v === "string") body[key] = v;
    }
    pdfClear = form.get("pdfClear") === "1";
    const file = form.get("pdf");
    if (file && typeof file !== "string" && file.size > 0) {
      const bytes = Buffer.from(await file.arrayBuffer());
      const name = file.name || "";
      const type = file.type || "";
      if (bytes.length > PDF_MAX_BYTES) {
        return bad("PDF attachment must be 1 MB or smaller");
      }
      if (!name.toLowerCase().endsWith(".pdf") && type !== "application/pdf") {
        return bad("Attachment must be a PDF file");
      }
      pdf = bytes;
      pdfName = name;
    }
  } else {
    body = await request.json().catch(() => ({}));
    pdfClear = body.pdfClear === "1";
  }

  const id = String(body.id ?? "").trim();
  if (!id) return bad("id is required");

  const booking = await prisma.booking.findUnique({ where: { id } });
  if (!booking) return bad("Booking not found", 404);
  if (booking.status === "CANCELLED") return bad("A cancelled booking cannot be edited", 409);

  const canEdit = booking.userId === user.id || user.role === "ADMIN";
  if (!canEdit) {
    return bad("Only the booker or an app admin can edit this booking", 403);
  }

  if (slotIndex(booking.date, booking.startMin) <= slotIndex(istDateKey(), istMinute())) {
    return bad("A slot that has already started cannot be edited");
  }

  // New slot range (defaults to the current one).
  const startDate = String(body.startDate ?? booking.date).trim();
  let endDate = String(body.endDate ?? (booking.endDate || booking.date)).trim();
  const startMin = body.startMin === undefined ? booking.startMin : Number(body.startMin);
  const endMin = body.endMin === undefined ? booking.endMin : Number(body.endMin);
  const purpose =
    body.purpose === undefined ? booking.purpose : String(body.purpose ?? "").trim() || null;

  if (!DATE_RE.test(startDate)) return bad("start date (YYYY-MM-DD) is invalid");
  if (!endDate) endDate = startDate;
  if (endDate < startDate) return bad("The end date cannot be before the start date");
  if (!Number.isInteger(startMin) || !Number.isInteger(endMin) || startMin < 0 || endMin > 1440) {
    return bad("Invalid slot times");
  }

  const startIdx = slotIndex(startDate, startMin);
  const endIdx = slotIndex(endDate, endMin);
  if (endIdx <= startIdx) return bad("The slot end must be after its start");
  const duration = endIdx - startIdx;
  if (duration < SLOT_MIN_MINUTES) {
    return bad(`Minimum booking duration is ${SLOT_MIN_MINUTES} minutes`);
  }
  if (startIdx <= slotIndex(istDateKey(), istMinute())) {
    return bad("You cannot move a booking into the past (times are Indian Standard Time)");
  }

  const facility = await prisma.facility.findUnique({
    where: { id: booking.facilityId },
    include: { building: true, roleLimits: true },
  });
  if (!facility || !facility.active || !facility.building.active) {
    return bad("This facility is not available for booking");
  }

  // Duration limits use the FOR-user's role for on-behalf blocks.
  let capRole = user.primaryRole ?? null;
  if (booking.type === "ON_BEHALF" && booking.forUserId) {
    const forUser = await prisma.appUser.findUnique({ where: { id: booking.forUserId } });
    capRole = forUser?.primaryRole ?? null;
  }
  const effMax = effectiveMaxMinutes(
    facility,
    facility.roleLimits.map((r) => ({ role: r.role, maxMinutes: r.maxMinutes })),
    capRole
  );
  if (effMax !== null && duration > effMax && user.role !== "ADMIN") {
    const fmtMax =
      effMax % 60 === 0
        ? `${effMax / 60} hour${effMax === 60 ? "" : "s"}`
        : `${effMax} minutes`;
    return bad(
      `The maximum booking duration for this facility is ${fmtMax}. Please pick a shorter range — or ask the app administrator to raise the limit.`
    );
  }

  const CONFLICT_MSG = "That time range is already booked — please pick a free range";
  let updated: Prisma.BookingGetPayload<{ select: typeof BOOKING_LIST_SELECT }>;
  try {
    updated = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Facility" WHERE id = ${facility.id} FOR UPDATE`;
      if (await hasConflict(tx, facility.id, startDate, endDate, startMin, endMin, id)) {
        throw new SlotConflict(CONFLICT_MSG);
      }
      const data: Prisma.BookingUncheckedUpdateInput = {
        date: startDate,
        endDate,
        startMin,
        endMin,
        purpose,
      };
      if (pdf && pdfName) {
        const b = new Uint8Array(pdf.byteLength);
        b.set(pdf);
        data.pdf = b;
        data.pdfName = pdfName;
      } else if (pdfClear) {
        data.pdf = null;
        data.pdfName = null;
      }
      return await tx.booking.update({
        where: { id },
        data,
        select: BOOKING_LIST_SELECT,
      });
    });
  } catch (e) {
    if (e instanceof SlotConflict || isExclusionViolation(e)) {
      return bad(CONFLICT_MSG, 409);
    }
    throw e;
  }
  return NextResponse.json({
    booking: { ...updated, pdf: Boolean(updated.pdfName) },
    message: "Booking updated",
  });
}

export async function DELETE(request: NextRequest) {
  const user = await currentUser();
  if (!user) return bad("unauthorized", 401);

  // Reason travels as a query param (DELETE bodies are unreliable). Accept
  // one id, or several comma-separated ids for bulk cancellation.
  const { searchParams } = new URL(request.url);
  const idParam = searchParams.get("id");
  const reason = (searchParams.get("reason") ?? "").trim().slice(0, 500) || null;
  if (!idParam) return bad("id is required");
  const ids = idParam.split(",").map((s) => s.trim()).filter(Boolean);

  const rows = await prisma.booking.findMany({ where: { id: { in: ids } } });
  if (rows.length === 0) return bad("No matching bookings found", 404);

  const nowIdx = slotIndex(istDateKey(), istMinute());
  const results = [];
  const skipped = [];

  for (const booking of rows) {
    // Who may cancel: the booker, the user the slot is blocked FOR (their own
    // blocked slot), or an app ADMIN.
    const canCancel =
      booking.userId === user.id || booking.forUserId === user.id || user.role === "ADMIN";
    if (!canCancel) {
      skipped.push({ id: booking.id, reason: "not authorized" });
      continue;
    }
    if (booking.status === "CANCELLED") {
      skipped.push({ id: booking.id, reason: "already cancelled" });
      continue;
    }
    if (slotIndex(booking.date, booking.startMin) <= nowIdx) {
      skipped.push({ id: booking.id, reason: "already started" });
      continue;
    }
    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledById: user.id,
        cancelReason: reason,
      },
    });
    results.push(booking.id);
  }

  return NextResponse.json({
    cancelled: results,
    skipped,
    message:
      results.length === 0
        ? "Nothing was cancelled"
        : `${results.length} booking${results.length === 1 ? "" : "s"} cancelled`,
  });
}
