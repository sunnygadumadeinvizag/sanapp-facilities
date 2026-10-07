import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { decidableFacilityIds, facilityAccess } from "@/lib/approval";
import { availabilityError, normaliseAvailability } from "@/lib/availability";
import { istDateKey } from "@/lib/ist";

/**
 * The bookable availability of a facility: the hours it may be booked on, the
 * recurring weekdays it is closed, the individual dates it is closed, and the
 * longest booking it accepts.
 *
 * Who may change it: the app admin, the facility's approval people, and its
 * POCs — the same people who decide its booking requests. Everybody else sees
 * the values on the booking calendar but cannot edit them.
 *
 * Narrowing the availability never touches bookings that already exist: a slot
 * that was confirmed while it was still bookable stays confirmed, and the
 * response says how many upcoming bookings now sit outside the new hours so an
 * admin can decide what to do about them.
 */

const AVAILABILITY_SELECT = {
  id: true,
  name: true,
  openMin: true,
  closeMin: true,
  closedWeekdays: true,
  closedDates: true,
  maxMinutes: true,
  requiresApproval: true,
  isLab: true,
  hasAvSupport: true,
  avSupportRequired: true,
  active: true,
  building: { select: { id: true, name: true, maxMinutes: true } },
} as const;

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const scope = await decidableFacilityIds(user.id, user.role);
  if (scope !== "all" && scope.length === 0) {
    return NextResponse.json({ facilities: [], canManage: false });
  }

  const facilities = await prisma.facility.findMany({
    where: scope === "all" ? {} : { id: { in: scope } },
    select: AVAILABILITY_SELECT,
    orderBy: [{ building: { name: "asc" } }, { name: "asc" }],
  });

  return NextResponse.json({
    facilities: facilities.map((f) => ({
      ...f,
      buildingName: f.building.name,
      buildingMaxMinutes: f.building.maxMinutes,
    })),
    canManage: true,
  });
}

export async function PATCH(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const id = String(body.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const access = await facilityAccess(id, user.id, user.role);
  if (!access.manages) {
    return NextResponse.json(
      {
        error:
          "Only the app administrator, this facility's approval people or its POCs can change its availability",
      },
      { status: 403 }
    );
  }

  const av = normaliseAvailability(body);
  if (!av.ok) return NextResponse.json({ error: av.error }, { status: 400 });

  const data: Record<string, unknown> = {
    openMin: av.value.openMin,
    closeMin: av.value.closeMin,
    closedWeekdays: av.value.closedWeekdays,
    closedDates: av.value.closedDates,
  };

  // The maximum length of one booking. null / "" clears it back to whatever the
  // building or the platform allows.
  if (body.maxMinutes !== undefined) {
    const raw = body.maxMinutes;
    if (raw === null || raw === "" || raw === "none") {
      data.maxMinutes = null;
    } else {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 15 || n > 1440) {
        return NextResponse.json(
          { error: "The maximum booking length must be between 15 and 1440 minutes" },
          { status: 400 }
        );
      }
      data.maxMinutes = n;
    }
  }

  let facility;
  try {
    facility = await prisma.facility.update({ where: { id }, data, select: AVAILABILITY_SELECT });
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === "P2025") return NextResponse.json({ error: "Facility not found" }, { status: 404 });
    throw e;
  }

  // How many upcoming bookings now fall outside the new availability? They are
  // deliberately kept — they were valid when they were made — but the person
  // who narrowed the hours should know they exist.
  const today = istDateKey();
  const upcoming = await prisma.booking.findMany({
    where: { facilityId: id, status: { in: ["CONFIRMED", "PENDING_APPROVAL"] }, date: { gte: today } },
    select: { date: true, endDate: true, startMin: true, endMin: true, status: true },
    take: 1000,
  });
  const outside = upcoming.filter(
    (b) =>
      availabilityError(
        av.value,
        b.date,
        b.startMin,
        b.endDate && b.endDate >= b.date ? b.endDate : b.date,
        b.endMin
      ) !== null
  ).length;

  return NextResponse.json({
    facility: {
      ...facility,
      buildingName: facility.building.name,
      buildingMaxMinutes: facility.building.maxMinutes,
    },
    outsideUpcoming: outside,
    message:
      outside > 0
        ? `Saved. ${outside} upcoming booking${outside === 1 ? "" : "s"} now sit outside these hours — they were kept as they are.`
        : "Saved.",
  });
}
