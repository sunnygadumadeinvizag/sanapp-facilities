import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { apiPath } from "iipe-common-ui";
import { prisma } from "@/lib/prisma";
import { verifyAppSession } from "@/lib/session";
import { AppShell } from "./components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { istDateKey } from "@/lib/ist";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const store = await cookies();
  const session = store.get("app4_session")?.value ?? "";
  const me = await verifyAppSession(session);
  // The proxy does not run for the exact basePath root, so guard it here.
  if (!me) {
    redirect(process.env.APP_BASE_URL! + "/api/start-oauth");
  }

  const buildings = await prisma.building.findMany({
    where: { active: true },
    orderBy: [{ order: "asc" }, { name: "asc" }],
    include: {
      facilities: {
        where: { active: true },
        select: { id: true, name: true },
      },
    },
  });

  return (
    <AppShell
      me={me}
      active="home"
      sidebarItems={[
        { label: "Facilities Home", href: "/", active: true },
        { label: "My Bookings", href: "/my-bookings" },
        { label: "My Account", href: `${process.env.SSO_BASE_URL}/account` },
        { label: "SSO (identity)", href: process.env.SSO_BASE_URL! },
        { label: "Main (access)", href: process.env.MAIN_BASE_URL! },
      ]}
    >
      <h1 className="iipe-page-title">Facilities Booking</h1>
      <p className="iipe-page-sub">
        Book institute facilities — buildings, rooms and slots. All times are{" "}
        <strong>Indian Standard Time (IST)</strong>, server time. Drag on the calendar to pick a
        range — 15 minutes up to 3 hours (self), longer blocks by designated POCs.
      </p>

      {params.error && (
        <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          Sign-in error: {params.error}
        </div>
      )}

      {buildings.length === 0 ? (
        <Card className="p-6 text-muted-foreground">
          No buildings have been added yet. An app administrator can add them.
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {buildings.map((b) => (
            <a key={b.id} href={apiPath(`/buildings/${b.id}`)} className="block no-underline">
              <Card className="h-full p-5 transition-shadow hover:shadow-md">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold">{b.name}</h3>
                    {b.code && <p className="text-xs text-muted-foreground">{b.code}</p>}
                  </div>
                  <Badge variant="secondary" className="shrink-0">
                    {b.facilities.length} facility{b.facilities.length === 1 ? "" : "ies"}
                  </Badge>
                </div>
                {b.description && (
                  <p className="mt-2 text-sm text-muted-foreground">{b.description}</p>
                )}
                {b.location && <p className="mt-2 text-xs text-muted-foreground">📍 {b.location}</p>}
                <p className="mt-3 text-xs text-muted-foreground">
                  Today (IST): {istDateKey()}
                </p>
              </Card>
            </a>
          ))}
        </div>
      )}
    </AppShell>
  );
}
