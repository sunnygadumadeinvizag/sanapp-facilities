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
} from "@/lib/ist";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function isPastSlot(date: string, startMin: number): boolean {
  // A slot on an earlier day, or today with a start time already reached, is in the past.
  return date < istDateKey() || (date === istDateKey() && startMin <= istMinute());
}

/** Overlap test: any CONFIRMED booking on the same facility+date intersecting [start,end). */
async function hasConflict(
  facilityId: string,
  date: string,
  startMin: number,
  endMin: number,
  excludeId?: string
) {
  const overlapping = await prisma.booking.findFirst({
    where: {
      facilityId,
      date,
      status: "CONFIRMED",
      NOT: excludeId ? { id: excludeId } : undefined,
      startMin: { lt: endMin },
      endMin: { gt: startMin },
    },
  });
  return overlapping !== null;
}

export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) return bad("unauthorized", 401);

  const { searchParams } = new URL(request.url);
  const facilityId = searchParams.get("facilityId");
  const date = searchParams.get("date");
  const mine = searchParams.get("mine") === "1";
  const all = searchParams.get("all") === "1";

  if (all) {
    if (user.role !== "ADMIN") return bad("forbidden", 403);
    const rows = await prisma.booking.findMany({
      orderBy: [{ date: "desc" }, { startMin: "desc" }],
      select: {
        id: true,
        type: true,
        status: true,
        date: true,
        startMin: true,
        endMin: true,
        purpose: true,
        pdfName: true,
        facility: { select: { id: true, name: true, building: { select: { id: true, name: true } } } },
        user: { select: { id: true, username: true, name: true } },
        forUser: { select: { id: true, username: true, name: true } },
      },
    });
    const bookings = rows.map(({ pdfName, ...rest }) => ({ ...rest, pdf: Boolean(pdfName) }));
    return NextResponse.json({ bookings });
  }

  if (mine) {
    const rows = await prisma.booking.findMany({
      where: { userId: user.id },
      orderBy: [{ date: "asc" }, { startMin: "asc" }],
      select: {
        id: true,
        type: true,
        status: true,
        date: true,
        startMin: true,
        endMin: true,
        purpose: true,
        pdfName: true,
        facility: { select: { id: true, name: true, building: { select: { id: true, name: true } } } },
        forUser: { select: { id: true, username: true, name: true } },
      },
    });
    const bookings = rows.map(({ pdfName, ...rest }) => ({ ...rest, pdf: Boolean(pdfName) }));
    return NextResponse.json({ bookings });
  }

  if (!facilityId || !date || !DATE_RE.test(date)) {
    return bad("facilityId and date (YYYY-MM-DD) are required");
  }
  const bookings = await prisma.booking.findMany({
    where: { facilityId, date, status: "CONFIRMED" },
    orderBy: { startMin: "asc" },
    include: {
      user: { select: { id: true, username: true, name: true } },
      forUser: { select: { id: true, username: true, name: true } },
    },
  });
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
    for (const key of ["facilityId", "date", "startMin", "endMin", "purpose", "forUserId"]) {
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
  const date = String(body.date ?? "").trim();
  const startMin = Number(body.startMin);
  const endMin = Number(body.endMin);
  const purpose = String(body.purpose ?? "").trim();
  const forUserId = String(body.forUserId ?? "").trim();

  if (!facilityId || !date || !DATE_RE.test(date)) {
    return bad("facilityId and date (YYYY-MM-DD) are required");
  }
  if (!Number.isInteger(startMin) || !Number.isInteger(endMin) || startMin < 0 || endMin > 1440 || endMin <= startMin) {
    return bad("Invalid slot times");
  }

  const duration = endMin - startMin;
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
  if (isPastSlot(date, startMin)) {
    return bad("You cannot book a slot that has already started (times are Indian Standard Time)");
  }

  if ((type === "ON_BEHALF" || type === "LONG") && !purpose) {
    return bad("A description is required for this type of booking");
  }

  if (await hasConflict(facilityId, date, startMin, endMin)) {
    return bad(
      `That slot is already booked (${fmtMin(startMin)} – ${fmtMin(endMin)} IST overlaps an existing booking)`,
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
      date,
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
  if (isPastSlot(booking.date, booking.startMin)) {
    return bad("A slot that has already started cannot be cancelled");
  }

  await prisma.booking.update({
    where: { id },
    data: { status: "CANCELLED" },
  });
  return NextResponse.json({ ok: true });
}
