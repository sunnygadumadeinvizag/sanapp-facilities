import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
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
};

async function hasConflict(
  facilityId: string,
  startDate: string,
  endDate: string,
  startMin: number,
  endMin: number,
  excludeId?: string
) {
  const startIdx = slotIndex(startDate, startMin);
  const endIdx = slotIndex(endDate, endMin);
  const overlapping = await prisma.booking.findMany({
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

  if (all) {
    if (user.role !== "ADMIN") return bad("forbidden", 403);
    const rows = await prisma.booking.findMany({
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
      where: { userId: user.id },
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
    for (const key of ["facilityId", "date", "endDate", "startDate", "startMin", "endMin", "purpose", "forUserId"]) {
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
    include: { building: true },
  });
  if (!facility || !facility.active || !facility.building.active) {
    return bad("This facility is not available for booking");
  }

  // Booking type is derived from the duration:
  //   ≤ 3 hours  → SELF (any eligible user) or ON_BEHALF (approver, for another user)
  //   > 3 hours  → LONG (POC only, on their own name)
  let type: "SELF" | "ON_BEHALF" | "LONG" = "SELF";
  if (duration > SLOT_MAX_MINUTES) {
    type = "LONG";
    if (!user.isPoc && user.role !== "ADMIN") {
      return bad("Only designated POCs (or an app ADMIN) can book slots longer than 3 hours", 403);
    }
    if (forUserId) {
      return bad("Long bookings (> 3 hours) are made on the booker's own name", 400);
    }
  } else {
    if (forUserId) {
      type = "ON_BEHALF";
      if (!user.isApprover && user.role !== "ADMIN") {
        return bad("Only users with approval access (or an app ADMIN) can block a slot for another user", 403);
      }
    }
  }

  // Eligibility — which SSO primary roles may book this facility.
  // ADMINs can book any facility regardless of their own primary role.
  // ON_BEHALF bookings check the FOR-user's eligibility, not the booker's.
  if (facility.allowedRoles.length > 0 && user.role !== "ADMIN") {
    let eligibleRole: string | null = null;
    if (type === "ON_BEHALF" && forUserId) {
      const forUser = await prisma.appUser.findUnique({ where: { id: forUserId } });
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

  // The slot must not be in the past (server time is IST).
  const nowIdx = slotIndex(istDateKey(), istMinute());
  if (startIdx <= nowIdx) {
    return bad("You cannot book a slot that has already started (times are Indian Standard Time)");
  }

  if ((type === "ON_BEHALF" || type === "LONG") && !purpose) {
    return bad("A description is required for this type of booking");
  }

  if (await hasConflict(facilityId, startDate, endDate, startMin, endMin)) {
    return bad(
      "That time range is already booked — please pick a free range in the calendar",
      409
    );
  }

  const booking = await prisma.booking.create({
    data: {
      facilityId,
      userId: user.id,
      forUserId: type === "ON_BEHALF" ? forUserId : null,
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

  return NextResponse.json(
    { booking, message: "Booking confirmed" },
    { status: 201 }
  );
}

export async function DELETE(request: NextRequest) {
  const user = await currentUser();
  if (!user) return bad("unauthorized", 401);

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return bad("id is required");

  const booking = await prisma.booking.findUnique({ where: { id } });
  if (!booking) return bad("Booking not found", 404);

  const canCancel =
    booking.userId === user.id || user.role === "ADMIN" || user.isApprover || user.isPoc;
  if (!canCancel) {
    return bad("You can only cancel your own bookings", 403);
  }

  // Only future slots can be cancelled.
  const endDay = endDayOf(booking.date, booking.endDate);
  if (slotIndex(booking.date, booking.startMin) <= slotIndex(istDateKey(), istMinute())) {
    return bad("A slot that has already started cannot be cancelled");
  }

  await prisma.booking.update({
    where: { id },
    data: { status: "CANCELLED" },
  });
  return NextResponse.json({ ok: true });
}
