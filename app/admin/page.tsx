import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyAppSession } from "@/lib/session";
import { isAdminSession } from "@/lib/auth";
import { istDateKey } from "@/lib/ist";
import { AppShell } from "../components/AppShell";
import { AdminsCard } from "../components/AdminsCard";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-bold">{value}</div>
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function PageCard({
  title,
  description,
  href,
}: {
  title: string;
  description: string;
  href: string;
}) {
  return (
    <a href={href} className="block">
      <Card className="transition-colors hover:border-primary/60">
        <CardContent className="p-5">
          <div className="font-semibold text-primary">{title} →</div>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </CardContent>
      </Card>
    </a>
  );
}

export default async function AdminOverviewPage() {
  const store = await cookies();
  const session = store.get("app4_session")?.value ?? "";
  const me = await verifyAppSession(session);
  if (!me) {
    return <p className="iipe-container">Session not found.</p>;
  }
  const admin = await isAdminSession();

  if (!admin) {
    return (
      <AppShell me={me} active="admin">
        <h1 className="iipe-page-title">App Administration</h1>
        <Card className="p-6">
          <h2 className="text-lg font-semibold">Administrator access required</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Only an app administrator can manage buildings, facilities, POCs and bookings.
          </p>
        </Card>
      </AppShell>
    );
  }

  const today = istDateKey();
  const [buildingCount, facilityCount, buildingPocCount, facilityPocCount, bookingsToday, upcoming] =
    await Promise.all([
      prisma.building.count({ where: { active: true } }),
      prisma.facility.count({ where: { active: true } }),
      prisma.buildingPoc.count(),
      prisma.facilityPoc.count(),
      prisma.booking.count({ where: { status: "CONFIRMED", date: today } }),
      prisma.booking.count({ where: { status: "CONFIRMED", date: { gte: today } } }),
    ]);

  return (
    <AppShell me={me} active="admin">
      <h1 className="iipe-page-title">App Administration</h1>
      <p className="iipe-page-sub">
        Track every building, facility and POC in one place. POCs are managed per building and per
        facility — a building POC automatically covers every facility in that building. Users who
        need long hours simply ask a POC to book the slot for them.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="Buildings" value={buildingCount} hint="active" />
        <Stat label="Facilities" value={facilityCount} hint="active" />
        <Stat label="POC assignments" value={buildingPocCount + facilityPocCount} hint={`${buildingPocCount} building · ${facilityPocCount} facility`} />
        <Stat label="Bookings today" value={bookingsToday} hint="confirmed slots starting today" />
        <Stat label="Upcoming bookings" value={upcoming} hint="confirmed from today onwards" />
      </div>

      <h2 className="mt-8 text-lg font-semibold">Manage</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <PageCard
          title="Buildings & POCs"
          description="Add buildings, set default booking caps, and assign building POCs (they cover every facility in the building)."
          href="/admin/buildings"
        />
        <PageCard
          title="Facilities & POCs"
          description="Add facilities to buildings, control who may book and for how long, and assign facility-level POCs."
          href="/admin/facilities"
        />
        <PageCard
          title="All Bookings"
          description="Search, filter and track every booking — by building, facility, user, date range or status."
          href="/admin/all-bookings"
        />
      </div>

      <h2 className="mt-8 text-lg font-semibold">App administrators</h2>
      <AdminsCard />
    </AppShell>
  );
}
