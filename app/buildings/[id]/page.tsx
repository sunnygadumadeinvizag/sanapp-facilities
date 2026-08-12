import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { Breadcrumb, apiPath } from "iipe-common-ui";
import { prisma } from "@/lib/prisma";
import { verifyAppSession } from "@/lib/session";
import { AppShell } from "../../components/AppShell";
import type { SlotItem } from "../../components/BookingClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { istDateKey, istMinute, SLOT_MAX_MINUTES, fmtMin } from "@/lib/ist";
import { capLabel } from "@/lib/limits";
import { primaryRoleLabel } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function BuildingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const store = await cookies();
  const session = store.get("app4_session")?.value ?? "";
  const me = await verifyAppSession(session);
  if (!me) {
    // The proxy normally handles this; guard here too for direct hits.
    return <p className="iipe-container">Session not found.</p>;
  }

  const building = await prisma.building.findUnique({
    where: { id },
    include: {
      facilities: {
        where: { active: true },
        orderBy: { name: "asc" },
        include: {
          roleLimits: { select: { role: true, maxMinutes: true } },
          bookings: {
            where: { date: istDateKey(), status: "CONFIRMED" },
            orderBy: { startMin: "asc" },
            include: {
              user: { select: { id: true, username: true, name: true } },
              forUser: { select: { id: true, username: true, name: true } },
            },
          },
        },
      },
    },
  });

  if (!building || !building.active) {
    notFound();
  }

  const today = istDateKey();
  const nowMin = istMinute();

  return (
    <AppShell
      me={me}
      active="home"
      sidebarItems={[
        { label: "Facilities Home", href: "/", active: false },
        { label: "My Bookings", href: "/my-bookings", active: false },
        { label: "My Account", href: `${process.env.SSO_BASE_URL}/account`, active: false },
        { label: "SSO (identity)", href: process.env.SSO_BASE_URL!, active: false },
        { label: "Main (access)", href: process.env.MAIN_BASE_URL!, active: false },
      ]}
    >
      <div className="mb-3">
        <Breadcrumb
          items={[
            { label: "Facilities", href: "/" },
            { label: building.name },
          ]}
        />
      </div>

      <h1 className="iipe-page-title">{building.name}</h1>
      <p className="iipe-page-sub">
        {building.description ?? "Institute facility."}
        {building.location ? ` · ${building.location}` : ""}
        {building.code ? ` · Code: ${building.code}` : ""}
      </p>

      {building.facilities.length === 0 ? (
        <Card className="p-6 text-muted-foreground">No facilities have been added to this building yet.</Card>
      ) : (
        <div className="grid gap-4">
          {building.facilities.map((f) => {
            const slots: SlotItem[] = f.bookings.map((b) => ({
              id: b.id,
              startDate: b.date,
              endDate: b.endDate || b.date,
              startMin: b.startMin,
              endMin: b.endMin,
              bookerName: b.user.name,
              forName: b.forUser?.name ?? null,
            }));
            return (
              <Card key={f.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold">{f.name}</h3>
                    {f.capacity ? (
                      <p className="text-xs text-muted-foreground">Capacity: {f.capacity}</p>
                    ) : null}
                    {f.description && (
                      <p className="mt-1 text-sm text-muted-foreground">{f.description}</p>
                    )}
                    {capLabel(f.maxMinutes ?? building.maxMinutes ?? SLOT_MAX_MINUTES) && (
                      <p className="mt-1 text-xs font-medium text-primary">
                        Max {capLabel(f.maxMinutes ?? building.maxMinutes ?? SLOT_MAX_MINUTES)} per booking
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    {f.allowedRoles.length > 0 ? (
                      <Badge variant="secondary" className="whitespace-normal text-right">
                        {f.allowedRoles.map((r) => primaryRoleLabel(r)).join(" · ")}
                      </Badge>
                    ) : (
                      <Badge>Open to all</Badge>
                    )}
                    <Button size="sm" asChild>
                      <a href={apiPath(`/book/${f.id}`)}>Book a slot</a>
                    </Button>
                  </div>
                </div>
                {slots.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">Today:</span>
                    {slots.map((s) => (
                      <Badge
                        key={s.id}
                        variant="outline"
                        className="gap-1 text-red-700 border-red-300 bg-red-50"
                        title={s.forName ? `Blocked for ${s.forName}` : undefined}
                      >
                        {fmtMin(s.startMin)}–{fmtMin(s.endMin)} IST · {s.forName ?? s.bookerName}
                      </Badge>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        Open a facility to book — the calendar shows 7 days at a time. Drag to select a range and
        release to add it, including overnight and multi-day blocks. All times are IST (server time).
        Current IST time:{" "}
        {`${String(Math.floor(nowMin / 60)).padStart(2, "0")}:${String(nowMin % 60).padStart(2, "0")}`}.
      </p>
    </AppShell>
  );
}
