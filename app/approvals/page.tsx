import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyAppSession } from "@/lib/session";
import { currentUser } from "@/lib/auth";
import { decidableFacilityIds, listPendingApprovals, listRecentDecisions } from "@/lib/approval";
import { AppShell } from "../components/AppShell";
import { ApprovalsClient } from "../components/ApprovalsClient";
import { AvailabilityEditor } from "../components/AvailabilityEditor";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

/**
 * Approvals — the queue of slots requested on facilities that require an
 * approval, for the people who may decide them (the facility's approval
 * people, its POCs, its building's POCs and app admins).
 */
export default async function ApprovalsPage() {
  const store = await cookies();
  const session = store.get("app4_session")?.value ?? "";
  const me = await verifyAppSession(session);
  const local = await currentUser();
  if (!me || !local) {
    return <p className="iipe-container">Session not found.</p>;
  }

  const scope = await decidableFacilityIds(local.id, local.role);
  const canDecide = scope === "all" || scope.length > 0;

  if (!canDecide) {
    return (
      <AppShell me={me} active="approvals">
        <h1 className="iipe-page-title">Approvals</h1>
        <p className="iipe-page-sub">
          Slots requested on a facility that needs an approval wait here for the facility&apos;s
          approval person.
        </p>
        <Card>
          <CardContent className="p-6 flex flex-col gap-1">
            <h2 className="text-lg font-semibold">You are not an approval person</h2>
            <p className="text-sm text-muted-foreground">
              This page is for the people who decide booking requests: a facility&apos;s approval
              people, its POCs and its building&apos;s POCs. Ask the app administrator to add you as
              an approval person for a facility if you should decide its requests.
            </p>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const [pending, decided, facilities] = await Promise.all([
    listPendingApprovals(scope),
    listRecentDecisions(scope),
    prisma.facility.findMany({
      where: scope === "all" ? {} : { id: { in: scope } },
      select: { id: true, name: true, building: { select: { name: true } } },
      orderBy: [{ building: { name: "asc" } }, { name: "asc" }],
    }),
  ]);

  // Availability is set by the very same people who decide the requests: the
  // hours a facility may be booked on, the days it is closed and the longest
  // booking it accepts.
  const availabilityRows = await prisma.facility.findMany({
    where: scope === "all" ? {} : { id: { in: scope } },
    select: {
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
      building: { select: { name: true, maxMinutes: true } },
    },
    orderBy: [{ building: { name: "asc" } }, { name: "asc" }],
  });

  return (
    <AppShell me={me} active="approvals">
      <h1 className="iipe-page-title">Approvals</h1>
      <p className="iipe-page-sub">
        Every slot requested on a facility you approve for, waiting for your decision. Approving a
        request confirms its slot and emails the person who asked; declining frees the slot again.
        All times are Indian Standard Time (IST).
      </p>
      <ApprovalsClient
        initialPending={pending}
        initialDecided={decided}
        initialFacilities={facilities.map((f) => ({
          id: f.id,
          name: f.name,
          buildingName: f.building.name,
        }))}
      />

      {/* Availability — closing days, bookable hours and the booking caps. */}
      <div className="mt-8 flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold">Facility availability</h2>
          <p className="text-sm text-muted-foreground">
            The hours a facility may be booked on, the days it is closed (every week or just once),
            and the longest booking it accepts. The booking calendar follows these values at once,
            and every booking that already exists is kept as it is.
          </p>
        </div>
        <AvailabilityEditor
          initial={availabilityRows.map((f) => ({
            id: f.id,
            name: f.name,
            buildingName: f.building.name,
            openMin: f.openMin,
            closeMin: f.closeMin,
            closedWeekdays: f.closedWeekdays,
            closedDates: f.closedDates,
            maxMinutes: f.maxMinutes,
            requiresApproval: f.requiresApproval,
            isLab: f.isLab,
            hasAvSupport: f.hasAvSupport,
            avSupportRequired: f.avSupportRequired,
            active: f.active,
            buildingMaxMinutes: f.building.maxMinutes,
          }))}
        />
      </div>
    </AppShell>
  );
}
