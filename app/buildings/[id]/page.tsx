import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { Breadcrumb } from "iipe-common-ui";
import { prisma } from "@/lib/prisma";
import { verifyAppSession } from "@/lib/session";
import { AppShell } from "../../components/AppShell";
import { BookingClient, type SlotItem } from "../../components/BookingClient";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { istDateKey, istMinute, SLOT_MAX_MINUTES } from "@/lib/ist";
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

  // Designations (approver / POC) live on the local user, not the session.
  const local = await prisma.appUser.findUnique({ where: { username: me.username } });

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
            // ADMINs can book any facility (the server bypasses restrictions).
            const eligible =
              me.role === "ADMIN" ||
              f.allowedRoles.length === 0 ||
              (me.primaryRole ? f.allowedRoles.includes(me.primaryRole) : false);
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
                  {f.allowedRoles.length > 0 ? (
                    <Badge variant="secondary" className="whitespace-normal text-right">
                      {f.allowedRoles.map((r) => primaryRoleLabel(r)).join(" · ")}
                    </Badge>
                  ) : (
                    <Badge>Open to all</Badge>
                  )}
                </div>
                <BookingClient
                  facility={{ id: f.id, name: f.name }}
                  buildingName={building.name}
                  today={today}
                  todaySlots={slots}
                  me={{
                    name: me.name,
                    primaryRole: me.primaryRole ?? "",
                    role: local?.role ?? "USER",
                    isApprover: local?.isApprover ?? false,
                    isPoc: local?.isPoc ?? false,
                  }}
                  eligible={eligible}
                  nowMin={nowMin}
                  maxMinutes={f.maxMinutes}
                  buildingMaxMinutes={building.maxMinutes}
                  roleLimits={(f as any).roleLimits ?? []}
                />
              </Card>
            );
          })}
        </div>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        Slots shown for {today} (IST). Use the calendar in a facility card to view other days and
        book — drag to select a range, including overnight and multi-day blocks. Current IST time:{" "}
        {`${String(Math.floor(nowMin / 60)).padStart(2, "0")}:${String(nowMin % 60).padStart(2, "0")}`}.
      </p>
    </AppShell>
  );
}
