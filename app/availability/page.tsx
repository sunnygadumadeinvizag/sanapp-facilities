import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyAppSession } from "@/lib/session";
import { currentUser } from "@/lib/auth";
import { decidableFacilityIds } from "@/lib/approval";
import { AppShell } from "../components/AppShell";
import { AvailabilityEditor } from "../components/AvailabilityEditor";
import { dayWindowsFromDb } from "@/lib/availability";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

/**
 * Facility availability — the bookable hours, the closed days (every week or
 * just once) and the longest booking accepted, one facility at a time.
 *
 * Reached from its own sidebar entry, which appears for the very same people
 * who run a facility: the app admin, its approval people, its POCs and its
 * building's POCs — the same scope the Approvals queue uses.
 */
export default async function AvailabilityPage() {
  const store = await cookies();
  const session = store.get("app4_session")?.value ?? "";
  const me = await verifyAppSession(session);
  const local = await currentUser();
  if (!me || !local) {
    return <p className="iipe-container">Session not found.</p>;
  }

  const scope = await decidableFacilityIds(local.id, local.role);
  const canManage = scope === "all" || scope.length > 0;

  if (!canManage) {
    return (
      <AppShell me={me} active="availability">
        <h1 className="iipe-page-title">Facility availability</h1>
        <p className="iipe-page-sub">
          The hours a facility may be booked on, the days it is closed and the longest booking it
          accepts.
        </p>
        <Card>
          <CardContent className="p-6 flex flex-col gap-1">
            <h2 className="text-lg font-semibold">You manage no facility&apos;s availability</h2>
            <p className="text-sm text-muted-foreground">
              This page is for the people who run a facility: its approval people, its POCs and its
              building&apos;s POCs. Ask the app administrator to add you as an approval person for a
              facility if you should manage its availability.
            </p>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const availabilityRows = await prisma.facility.findMany({
    where: scope === "all" ? {} : { id: { in: scope } },
    select: {
      id: true,
      name: true,
      openMin: true,
      closeMin: true,
      closedWeekdays: true,
      closedDates: true,
      dayWindows: true,
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
    <AppShell me={me} active="availability">
      <h1 className="iipe-page-title">Facility availability</h1>
      <p className="iipe-page-sub">
        The hours a facility may be booked on, the days it is closed (every week or just once), and
        the longest booking it accepts. The booking calendar follows these values at once, and every
        booking that already exists is kept as it is. All times are Indian Standard Time (IST).
      </p>
      <AvailabilityEditor
        initial={availabilityRows.map((f) => ({
          id: f.id,
          name: f.name,
          buildingName: f.building.name,
          openMin: f.openMin,
          closeMin: f.closeMin,
          closedWeekdays: f.closedWeekdays,
          closedDates: f.closedDates,
          dayWindows: dayWindowsFromDb(f.dayWindows),
          maxMinutes: f.maxMinutes,
          requiresApproval: f.requiresApproval,
          isLab: f.isLab,
          hasAvSupport: f.hasAvSupport,
          avSupportRequired: f.avSupportRequired,
          active: f.active,
          buildingMaxMinutes: f.building.maxMinutes,
        }))}
      />
    </AppShell>
  );
}
