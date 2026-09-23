import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentUser, isAdmin } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const buildingId = searchParams.get("buildingId");
  const all = searchParams.get("all") === "1" && (await isAdmin());
  const facilities = await prisma.facility.findMany({
    where: buildingId
      ? { buildingId, ...(all ? {} : { active: true }) }
      : all
        ? {}
        : { active: true },
    orderBy: { name: "asc" },
    include: {
      building: { select: { id: true, name: true, maxMinutes: true } },
      roleLimits: { select: { role: true, maxMinutes: true } },
      pocs: {
        include: { user: { select: { id: true, name: true, username: true } } },
        orderBy: { createdAt: "asc" },
      },
      notifyConfig: {
        select: {
          notifyOnSlotBooked: true,
          notifyOnAvChange: true,
          notifyBookingUser: true,
          notifyForUser: true,
          notifyEmails: true,
        },
      },
    },
  });
  return NextResponse.json({ facilities });
}

/** Notifier emails: accept a string (comma/newline separated) or an array; validate shape. */
function normalizeNotifyEmails(value: unknown): string[] {
  const parts: string[] = Array.isArray(value)
    ? value.map((v) => String(v ?? ""))
    : typeof value === "string"
      ? value.split(/[\n,;]+/)
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of parts) {
    const email = raw.trim().toLowerCase();
    if (!email) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out.slice(0, 25);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({} as Record<string, unknown>));

  if ((body as { op?: string })?.op === "delete" && typeof (body as { id?: unknown }).id === "string") {
    if (!(await isAdmin())) {
      return NextResponse.json({ error: "Only the app administrator can manage facilities" }, { status: 403 });
    }
    const delId = String((body as { id: string }).id).trim();
    if (!delId) return NextResponse.json({ error: "id is required" }, { status: 400 });
    const bookingCount = await prisma.booking.count({ where: { facilityId: delId, status: "CONFIRMED" } });
    if (bookingCount > 0) {
      return NextResponse.json(
        { error: "This facility has active bookings — cancel them first" },
        { status: 409 }
      );
    }
    try {
      await prisma.facility.delete({ where: { id: delId } });
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code === "P2025") return NextResponse.json({ error: "Facility not found" }, { status: 404 });
      throw e;
    }
    return NextResponse.json({ ok: true });
  }

  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Only the app administrator can manage facilities" }, { status: 403 });
  }
  const buildingId = String((body as { buildingId?: unknown }).buildingId ?? "").trim();
  const name = String((body as { name?: unknown }).name ?? "").trim();
  if (!buildingId || !name) {
    return NextResponse.json({ error: "buildingId and facility name are required" }, { status: 400 });
  }

  const building = await prisma.building.findUnique({ where: { id: buildingId } });
  if (!building) {
    return NextResponse.json({ error: "Building not found" }, { status: 404 });
  }

  const allowedRoles = Array.isArray((body as { allowedRoles?: unknown }).allowedRoles)
    ? ((body as { allowedRoles: unknown[] }).allowedRoles as unknown[]).map(String).filter(Boolean)
    : [];

  const maxMinutes =
    (body as { maxMinutes: unknown }).maxMinutes === null || (body as { maxMinutes: unknown }).maxMinutes === ""
      ? null
      : Number.isInteger((body as { maxMinutes: unknown }).maxMinutes) &&
          Number((body as { maxMinutes: unknown }).maxMinutes) > 0
        ? Number((body as { maxMinutes: number }).maxMinutes)
        : null;

  const roleLimits = Array.isArray((body as { roleLimits?: unknown }).roleLimits)
    ? ((body as { roleLimits: unknown[] }).roleLimits as unknown[])
        .map((r: unknown) => ({
          role: String((r as { role?: unknown }).role ?? "").trim(),
          maxMinutes: Number((r as { maxMinutes?: unknown }).maxMinutes),
        }))
        .filter((r: { role: string; maxMinutes: number }) => r.role && Number.isInteger(r.maxMinutes) && r.maxMinutes > 0)
    : [];

  // Per-facility notify configuration (app admin decides who gets emailed).
  const notifyEmails = normalizeNotifyEmails((body as { notifyEmails?: unknown }).notifyEmails);
  const notifyOnSlotBooked = Boolean((body as { notifyOnSlotBooked?: unknown }).notifyOnSlotBooked);
  const notifyOnAvChange = Boolean((body as { notifyOnAvChange?: unknown }).notifyOnAvChange);
  const notifyBookingUser = Boolean((body as { notifyBookingUser?: unknown }).notifyBookingUser);
  const notifyForUser = Boolean((body as { notifyForUser?: unknown }).notifyForUser);

  const facility = await prisma.facility.create({
    data: {
      buildingId,
      name,
      description: (body as { description?: unknown }).description
        ? String((body as { description: string }).description).trim() || null
        : null,
      capacity:
        Number.isInteger((body as { capacity?: unknown }).capacity) &&
        Number((body as { capacity: number }).capacity) > 0
          ? Number((body as { capacity: number }).capacity)
          : null,
      allowedRoles,
      maxMinutes,
      hasAvSupport: Boolean((body as { hasAvSupport?: unknown }).hasAvSupport),
      roleLimits: { create: roleLimits },
      notifyConfig: {
        create: {
          notifyOnSlotBooked,
          notifyOnAvChange,
          notifyBookingUser,
          notifyForUser,
          notifyEmails,
        },
      },
    },
    include: {
      notifyConfig: {
        select: {
          notifyOnSlotBooked: true,
          notifyOnAvChange: true,
          notifyBookingUser: true,
          notifyForUser: true,
          notifyEmails: true,
        },
      },
    },
  });
  return NextResponse.json({ facility }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Only the app administrator can manage facilities" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const id = String((body as { id?: unknown }).id ?? "").trim();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const b = body as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  if (typeof b.name === "string" && b.name.trim()) data.name = b.name.trim();
  if (typeof b.description === "string") data.description = b.description.trim() || null;
  if (typeof b.capacity === "number" || b.capacity === null) {
    data.capacity = Number.isInteger(b.capacity) && (b.capacity as number) > 0 ? b.capacity : null;
  }
  if (Array.isArray(b.allowedRoles)) {
    data.allowedRoles = (b.allowedRoles as unknown[]).map(String).filter(Boolean);
  }
  if (b.maxMinutes === null || b.maxMinutes === "") {
    data.maxMinutes = null;
  } else if (Number.isInteger(b.maxMinutes) && Number(b.maxMinutes as number) > 0) {
    data.maxMinutes = Number(b.maxMinutes);
  }
  if (typeof b.active === "boolean") data.active = b.active;
  if (typeof b.hasAvSupport === "boolean") data.hasAvSupport = b.hasAvSupport;

  // Notify configuration — upserted so both create and edit forms manage it.
  // Only the fields actually supplied are written, so a partial PATCH can never
  // reset the rest of a facility's notification settings.
  const notifyUpdate: Record<string, unknown> = {};
  if (b.notifyOnSlotBooked !== undefined) notifyUpdate.notifyOnSlotBooked = Boolean(b.notifyOnSlotBooked);
  if (b.notifyOnAvChange !== undefined) notifyUpdate.notifyOnAvChange = Boolean(b.notifyOnAvChange);
  if (b.notifyBookingUser !== undefined) notifyUpdate.notifyBookingUser = Boolean(b.notifyBookingUser);
  if (b.notifyForUser !== undefined) notifyUpdate.notifyForUser = Boolean(b.notifyForUser);
  if (b.notifyEmails !== undefined) notifyUpdate.notifyEmails = normalizeNotifyEmails(b.notifyEmails);

  let facility;
  try {
    facility = await prisma.facility.update({ where: { id }, data });
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === "P2025") return NextResponse.json({ error: "Facility not found" }, { status: 404 });
    throw e;
  }

  if (Object.keys(notifyUpdate).length > 0) {
    await prisma.facilityNotifyConfig.upsert({
      where: { facilityId: id },
      update: notifyUpdate,
      create: { facilityId: id, ...notifyUpdate },
    });
  }

  if (Array.isArray(b.roleLimits)) {
    const roleLimits = (b.roleLimits as unknown[])
      .map((r: unknown) => ({
        role: String((r as { role?: unknown }).role ?? "").trim(),
        maxMinutes: Number((r as { maxMinutes?: unknown }).maxMinutes),
      }))
      .filter((r: { role: string; maxMinutes: number }) => r.role && Number.isInteger(r.maxMinutes) && r.maxMinutes > 0);
    await prisma.$transaction([
      prisma.facilityRoleLimit.deleteMany({ where: { facilityId: id } }),
      ...roleLimits.map((r: { role: string; maxMinutes: number }) =>
        prisma.facilityRoleLimit.create({ data: { facilityId: id, role: r.role, maxMinutes: r.maxMinutes } })
      ),
    ]);
  }

  const withConfig = await prisma.facility.findUnique({
    where: { id },
    include: {
      notifyConfig: {
        select: {
          notifyOnSlotBooked: true,
          notifyOnAvChange: true,
          notifyBookingUser: true,
          notifyForUser: true,
          notifyEmails: true,
        },
      },
    },
  });
  return NextResponse.json({ facility: withConfig ?? facility });
}

export async function DELETE(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Only the app administrator can manage facilities" }, { status: 403 });
  }
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const bookingCount = await prisma.booking.count({ where: { facilityId: id, status: "CONFIRMED" } });
  if (bookingCount > 0) {
    return NextResponse.json(
      { error: "This facility has active bookings — cancel them first" },
      { status: 409 }
    );
  }
  try {
    await prisma.facility.delete({ where: { id } });
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === "P2025") return NextResponse.json({ error: "Facility not found" }, { status: 404 });
    throw e;
  }
  return NextResponse.json({ ok: true });
}
