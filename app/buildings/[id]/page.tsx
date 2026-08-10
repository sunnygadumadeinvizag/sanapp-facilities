import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyAppSession } from "@/lib/session";
import { AppShell } from "../../components/AppShell";
import { BookingClient, type SlotItem } from "../../components/BookingClient";
import { istDateKey, istMinute } from "@/lib/ist";
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
      <nav className="iipe-breadcrumb">
        <a href="/">Facilities</a> <span>/</span> <span>{building.name}</span>
      </nav>

      <h1 className="iipe-page-title">{building.name}</h1>
      <p className="iipe-page-sub">
        {building.description ?? "Institute facility."}
        {building.location ? ` · ${building.location}` : ""}
        {building.code ? ` · Code: ${building.code}` : ""}
      </p>

      {building.facilities.length === 0 ? (
        <div className="iipe-card">
          <p className="iipe-muted" style={{ margin: 0 }}>
            No facilities have been added to this building yet.
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          {building.facilities.map((f) => {
            const slots: SlotItem[] = f.bookings.map((b) => ({
              id: b.id,
              startMin: b.startMin,
              endMin: b.endMin,
              bookerName: b.user.name,
              forName: b.forUser?.name ?? null,
            }));
            const eligible =
              f.allowedRoles.length === 0 ||
              (me.primaryRole ? f.allowedRoles.includes(me.primaryRole) : false);
            return (
              <div key={f.id} className="iipe-card">
                <div className="iipe-row" style={{ alignItems: "flex-start" }}>
                  <div style={{ minWidth: 0 }}>
                    <h3 style={{ margin: 0 }}>{f.name}</h3>
                    {f.capacity ? (
                      <div className="iipe-muted" style={{ fontSize: "0.85rem" }}>Capacity: {f.capacity}</div>
                    ) : null}
                    {f.description && (
                      <p className="iipe-muted" style={{ margin: "6px 0 0", fontSize: "0.92rem" }}>{f.description}</p>
                    )}
                  </div>
                  <span className="iipe-spacer" />
                  {f.allowedRoles.length > 0 ? (
                    <span className="iipe-badge" title="Restricted to these primary roles">
                      {f.allowedRoles.map((r) => primaryRoleLabel(r)).join(" · ")}
                    </span>
                  ) : (
                    <span className="iipe-badge">Open to all</span>
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
                />
              </div>
            );
          })}
        </div>
      )}

      <p className="iipe-muted" style={{ fontSize: "0.85rem", marginTop: 16 }}>
        Slots shown for {today} (IST). Use the date picker inside a facility card to view other
        days. Current IST time: {nowMin >= 720 ? `${Math.floor(nowMin / 60)}:${String(nowMin % 60).padStart(2, "0")}` : `${Math.floor(nowMin / 60)}:${String(nowMin % 60).padStart(2, "0")}`}.
      </p>
    </AppShell>
  );
}
