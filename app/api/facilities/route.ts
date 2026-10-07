import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentUser, isAdmin } from "@/lib/auth";
import { resolveUserByUsername } from "@/lib/poc";
import { normaliseAvailability } from "@/lib/availability";

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
      // The facility's approval people (who decide requests on it) and the
      // extra people allowed to see its slice of the dashboard.
      approvers: {
        include: { user: { select: { id: true, name: true, username: true } } },
        orderBy: { createdAt: "asc" },
      },
      dashboardViewers: {
        include: { user: { select: { id: true, name: true, username: true } } },
        orderBy: { createdAt: "asc" },
      },
      notifyConfig: {
        select: {
          notifyOnSlotBooked: true,
          notifyOnAvChange: true,
          notifyBookingUser: true,
          notifyForUser: true,
          notifyApproverOnRequest: true,
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

/**
 * Usernames submitted for a person list (approval people / dashboard viewers).
 * Accepts an array of usernames or objects carrying a username, or one comma /
 * newline separated string, and normalises to lower-case usernames.
 */
function normalizeUsernames(value: unknown): string[] {
  const parts: string[] = Array.isArray(value)
    ? value.map((v) =>
        v && typeof v === "object"
          ? String((v as { username?: unknown }).username ?? "")
          : String(v ?? "")
      )
    : typeof value === "string"
      ? value.split(/[\n,;]+/)
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of parts) {
    const username = raw.trim().replace(/^@/, "").toLowerCase();
    if (!username || seen.has(username)) continue;
    seen.add(username);
    out.push(username);
  }
  return out.slice(0, 100);
}

/**
 * Resolve usernames to local user ids, auto-provisioning from the SSO registry
 * where needed. Names that resolve to nobody are reported back so the caller can
 * refuse the whole change instead of silently dropping somebody.
 */
async function resolveUsernames(value: unknown): Promise<{ ids: string[]; unknown: string[] }> {
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const username of normalizeUsernames(value)) {
    const user = await resolveUserByUsername(username);
    if (!user) unknown.push(username);
    else if (!ids.includes(user.id)) ids.push(user.id);
  }
  return { ids, unknown };
}

function unknownUserError(usernames: string[]) {
  return NextResponse.json(
    {
      error: `No user found for ${usernames.map((u) => `“${u}”`).join(", ")} — check the username in the SSO registry`,
    },
    { status: 404 }
  );
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
  // "The approval people are emailed the moment a request is initiated."
  const notifyApproverOnRequest =
    (body as { notifyApproverOnRequest?: unknown }).notifyApproverOnRequest === undefined
      ? true
      : Boolean((body as { notifyApproverOnRequest?: unknown }).notifyApproverOnRequest);

  // Approval workflow + per-facility dashboard access. Both person lists are
  // resolved up front: an unknown username refuses the whole create, so a
  // facility never ends up with half of the people the admin picked.
  const requiresApproval = Boolean((body as { requiresApproval?: unknown }).requiresApproval);
  const approvers = await resolveUsernames(
    (body as { approverUsernames?: unknown }).approverUsernames
  );
  const viewers = await resolveUsernames(
    (body as { dashboardViewerUsernames?: unknown }).dashboardViewerUsernames
  );
  const unresolved = [...approvers.unknown, ...viewers.unknown];
  if (unresolved.length > 0) return unknownUserError(unresolved);

  // Bookable availability — optional at creation time (the defaults are the
  // whole day, never closed, which is how every facility behaved before).
  const availability =
    (body as { openMin?: unknown }).openMin === undefined &&
    (body as { closeMin?: unknown }).closeMin === undefined
      ? null
      : normaliseAvailability(body as Record<string, unknown>);
  if (availability && !availability.ok) {
    return NextResponse.json({ error: availability.error }, { status: 400 });
  }

  const hasAv = Boolean((body as { hasAvSupport?: unknown }).hasAvSupport);
  if (!hasAv && (body as { avSupportRequired?: unknown }).avSupportRequired) {
    return NextResponse.json(
      {
        error:
          "\u201cAV support required\u201d is only available on an AV facility — tick \u201cAV facility\u201d first",
      },
      { status: 400 }
    );
  }

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
      hasAvSupport: hasAv,
      isLab: Boolean((body as { isLab?: unknown }).isLab),
      // AV support can only be *required* on an AV facility.
      avSupportRequired: hasAv && Boolean((body as { avSupportRequired?: unknown }).avSupportRequired),
      ...(availability && availability.ok ? availability.value : {}),
      requiresApproval,
      approvers: { create: approvers.ids.map((userId) => ({ userId })) },
      dashboardViewers: { create: viewers.ids.map((userId) => ({ userId })) },
      roleLimits: { create: roleLimits },
      notifyConfig: {
        create: {
          notifyOnSlotBooked,
          notifyOnAvChange,
          notifyBookingUser,
          notifyForUser,
          notifyApproverOnRequest,
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
          notifyApproverOnRequest: true,
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
  if (typeof b.requiresApproval === "boolean") data.requiresApproval = b.requiresApproval;
  if (typeof b.isLab === "boolean") data.isLab = b.isLab;
  // "AV support required" is only meaningful on an AV facility: turning the AV
  // facility off clears it, and it cannot be set while AV support is off.
  if (typeof b.avSupportRequired === "boolean") {
    const avOn = typeof b.hasAvSupport === "boolean" ? b.hasAvSupport : undefined;
    if (avOn === false && b.avSupportRequired) {
      return NextResponse.json(
        {
          error:
            "\u201cAV support required\u201d is only available on an AV facility — tick \u201cAV facility\u201d first",
        },
        { status: 400 }
      );
    }
    data.avSupportRequired = b.avSupportRequired;
  } else if (b.hasAvSupport === false) {
    data.avSupportRequired = false;
  }
  // The bookable window / closed days may also be set from the admin form; the
  // approval people use /api/facilities/availability instead.
  if (b.openMin !== undefined || b.closeMin !== undefined || b.closedWeekdays !== undefined || b.closedDates !== undefined) {
    const av = normaliseAvailability(b);
    if (!av.ok) return NextResponse.json({ error: av.error }, { status: 400 });
    data.openMin = av.value.openMin;
    data.closeMin = av.value.closeMin;
    data.closedWeekdays = av.value.closedWeekdays;
    data.closedDates = av.value.closedDates;
  }

  // Notify configuration — upserted so both create and edit forms manage it.
  // Only the fields actually supplied are written, so a partial PATCH can never
  // reset the rest of a facility's notification settings.
  const notifyUpdate: Record<string, unknown> = {};
  if (b.notifyOnSlotBooked !== undefined) notifyUpdate.notifyOnSlotBooked = Boolean(b.notifyOnSlotBooked);
  if (b.notifyOnAvChange !== undefined) notifyUpdate.notifyOnAvChange = Boolean(b.notifyOnAvChange);
  if (b.notifyBookingUser !== undefined) notifyUpdate.notifyBookingUser = Boolean(b.notifyBookingUser);
  if (b.notifyForUser !== undefined) notifyUpdate.notifyForUser = Boolean(b.notifyForUser);
  if (b.notifyApproverOnRequest !== undefined) {
    notifyUpdate.notifyApproverOnRequest = Boolean(b.notifyApproverOnRequest);
  }
  if (b.notifyEmails !== undefined) notifyUpdate.notifyEmails = normalizeNotifyEmails(b.notifyEmails);

  // Resolve any submitted person lists BEFORE writing anything, so a typo
  // cannot leave the facility updated but its people not.
  const nextApprovers =
    b.approverUsernames === undefined ? null : await resolveUsernames(b.approverUsernames);
  const nextViewers =
    b.dashboardViewerUsernames === undefined
      ? null
      : await resolveUsernames(b.dashboardViewerUsernames);
  const unresolved = [...(nextApprovers?.unknown ?? []), ...(nextViewers?.unknown ?? [])];
  if (unresolved.length > 0) return unknownUserError(unresolved);

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

  // A submitted list replaces the whole list — the admin UI always sends the
  // complete set, exactly like the role limits above.
  if (nextApprovers) {
    await prisma.$transaction([
      prisma.facilityApprover.deleteMany({ where: { facilityId: id } }),
      ...nextApprovers.ids.map((userId) =>
        prisma.facilityApprover.create({ data: { facilityId: id, userId } })
      ),
    ]);
  }
  if (nextViewers) {
    await prisma.$transaction([
      prisma.facilityDashboardViewer.deleteMany({ where: { facilityId: id } }),
      ...nextViewers.ids.map((userId) =>
        prisma.facilityDashboardViewer.create({ data: { facilityId: id, userId } })
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
          notifyApproverOnRequest: true,
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
