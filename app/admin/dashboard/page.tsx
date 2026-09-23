import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyAppSession } from "@/lib/session";
import { isAdminSession } from "@/lib/auth";
import { addDays, istDateKey, mondayOf } from "@/lib/ist";
import { dashboardAccess } from "@/lib/dashboard";
import { AppShell } from "../../components/AppShell";
import { DashboardGrid } from "../../components/DashboardGrid";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function FacilitiesDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const store = await cookies();
  const session = store.get("app4_session")?.value ?? "";
  const me = await verifyAppSession(session);
  if (!me) {
    return <p className="p-6">Session not found.</p>;
  }
  const admin = await isAdminSession();
  const access = await dashboardAccess();

  const today = istDateKey();

  // Weeks run Monday → Sunday. `?week=YYYY-MM-DD` selects which week to
  // show: any date inside a week picks that whole week, and anything absent
  // or malformed falls back to the week containing today.
  const sp = await searchParams;
  const requested =
    typeof sp.week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? sp.week : null;
  const weekStart = mondayOf(requested ?? today);
  const from = weekStart;
  const to = addDays(weekStart, 6);

  if (!access.visible) {
    return (
      <AppShell me={me} active="admin-dashboard">
        <h1 className="text-xl font-semibold">Bookings Dashboard</h1>
        <Card className="p-6">
          <h2 className="text-lg font-semibold">You have not been added to this dashboard</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            The bookings dashboard is limited to the facilities and the people chosen by the app
            administrator. Ask the app administrator to add your username to the dashboard viewers
            list.
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

  // A booking's reference lives on the first slot of its submission group;
  // the other slots of the same booking carry no code of their own. Resolve
  // it per batch so every day of a multi-day booking shows the same readable
  // reference instead of falling back to a raw UUID.
  const batchIds = [
    ...new Set(bookings.map((b) => b.batchId).filter((v): v is string => Boolean(v))),
  ];
  const anchors =
    batchIds.length > 0
      ? await prisma.booking.findMany({
          where: { batchId: { in: batchIds }, code: { not: null } },
          select: { batchId: true, code: true },
          orderBy: { createdAt: "asc" },
        })
      : [];
  const codeByBatch = new Map<string, string>();
  for (const a of anchors) {
    if (a.batchId && a.code && !codeByBatch.has(a.batchId)) codeByBatch.set(a.batchId, a.code);
  }

  const fromIdx = Date.parse(`${from}T00:00:00Z`) / 60000;
  const toIdx = Date.parse(`${to}T00:00:00Z`) / 60000 + 1440;
  const dayIdx = (d: string) => Date.parse(`${d}T00:00:00Z`) / 60000;
  const endDay = (b: { date: string; endDate: string }) => (b.endDate && b.endDate >= b.date ? b.endDate : b.date);

  const slots = bookings
    .filter((b) => dayIdx(b.date) + b.startMin < toIdx && dayIdx(endDay(b)) + b.endMin > fromIdx)
    .map((b) => ({
      id: b.id,
      code: b.code ?? (b.batchId ? codeByBatch.get(b.batchId) : undefined) ?? "—",
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
        Monday {from} → Sunday {to}. Use the arrows to step through the weeks — only the
        facilities the app administrator added to this dashboard are shown.
      </p>
      <DashboardGrid
        today={today}
        from={from}
        to={to}
        facilities={facilities.map((f) => ({ id: f.id, name: f.name, buildingName: f.building.name }))}
        slots={slots}
        unconfigured={access.unconfigured}
        canConfigure={admin}
      />
    </AppShell>
  );
}
