import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyAppSession } from "@/lib/session";
import { isAdminSession } from "@/lib/auth";
import { addDays, istDateKey } from "@/lib/ist";
import { dashboardAccess } from "@/lib/dashboard";
import { AppShell } from "../../components/AppShell";
import { DashboardGrid } from "../../components/DashboardGrid";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function FacilitiesDashboardPage() {
  const store = await cookies();
  const session = store.get("app4_session")?.value ?? "";
  const me = await verifyAppSession(session);
  if (!me) {
    return <p className="p-6">Session not found.</p>;
  }
  const admin = await isAdminSession();
  const access = await dashboardAccess();

  const today = istDateKey();
  const from = today; // the next 7 days starting today
  const to = addDays(today, 6);

  if (!admin) {
    return (
      <AppShell me={me} active="admin-dashboard">
        <h1 className="text-xl font-semibold">Bookings Dashboard</h1>
        <Card className="p-6">
          <h2 className="text-lg font-semibold">Not available</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            The bookings dashboard is restricted — the app administrator decides who can see it.
          </p>
        </Card>
      </AppShell>
    );
  }

  if (!access.visible) {
    return (
      <AppShell me={me} active="admin-dashboard">
        <h1 className="text-xl font-semibold">Bookings Dashboard</h1>
        <Card className="p-6">
          <h2 className="text-lg font-semibold">You have not been added to this dashboard</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            The dashboard is limited to specific facilities and viewers chosen by the app
            administrator. Ask the app administrator to add your username to the dashboard
            viewers list.
          </p>
        </Card>
      </AppShell>
    );
  }

  const facilities = access.facilityIds
    ? await prisma.facility.findMany({
        where: { id: { in: access.facilityIds } },
        select: {
          id: true,
          name: true,
          building: { select: { id: true, name: true } },
        },
        orderBy: { name: "asc" },
      })
    : [];

  // Confirmed slots overlapping the next 7 days, per configured facility.
  const bookings =
    facilities.length > 0
      ? await prisma.booking.findMany({
          where: { facilityId: { in: facilities.map((f) => f.id) }, status: "CONFIRMED" },
          select: {
            id: true,
            code: true,
            batchId: true,
            facilityId: true,
            date: true,
            endDate: true,
            startMin: true,
            endMin: true,
            purpose: true,
            needAvSupport: true,
            user: { select: { name: true, username: true } },
            forUser: { select: { name: true, username: true } },
          },
          orderBy: [{ date: "asc" }, { startMin: "asc" }],
        })
      : [];

  const fromIdx = Date.parse(`${from}T00:00:00Z`) / 60000;
  const toIdx = Date.parse(`${to}T00:00:00Z`) / 60000 + 1440;
  const dayIdx = (d: string) => Date.parse(`${d}T00:00:00Z`) / 60000;
  const endDay = (b: { date: string; endDate: string }) => (b.endDate && b.endDate >= b.date ? b.endDate : b.date);

  const slots = bookings
    .filter((b) => dayIdx(b.date) + b.startMin < toIdx && dayIdx(endDay(b)) + b.endMin > fromIdx)
    .map((b) => ({
      id: b.id,
      code: b.code ?? b.batchId ?? b.id,
      facilityId: b.facilityId,
      date: b.date,
      endDate: endDay(b),
      startMin: b.startMin,
      endMin: b.endMin,
      purpose: b.purpose,
      needAvSupport: b.needAvSupport,
      bookedBy: b.forUser ? `${b.forUser.name} (@${b.forUser.username})` : b.user ? `${b.user.name} (@${b.user.username})` : "—",
    }));

  return (
    <AppShell me={me} active="admin-dashboard">
      <h1 className="text-xl font-semibold">Bookings Dashboard</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        The next 7 days ({from} → {to}) for the facilities the app administrator added to this
        dashboard. Only those facilities&apos; confirmed slots are shown.
      </p>
      <DashboardGrid
        today={today}
        from={from}
        to={to}
        facilities={facilities.map((f) => ({ id: f.id, name: f.name, buildingName: f.building.name }))}
        slots={slots}
        unconfigured={access.unconfigured}
        canConfigure
      />
    </AppShell>
  );
}
