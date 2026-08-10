import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyAppSession } from "@/lib/session";
import { apiPath } from "iipe-common-ui";
import { AppShell } from "./components/AppShell";
import { istDateKey, fmtMin } from "@/lib/ist";

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
        <strong>Indian Standard Time (IST)</strong>, server time. Slots run from
        15 minutes up to 3 hours; longer blocks are made by designated POCs.
      </p>

      {params.error && (
        <div className="iipe-alert danger">Sign-in error: {params.error}</div>
      )}

      {buildings.length === 0 ? (
        <div className="iipe-card">
          <p className="iipe-muted" style={{ margin: 0 }}>
            No buildings have been added yet. An app administrator can add them.
          </p>
        </div>
      ) : (
        <div className="iipe-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
          {buildings.map((b) => (
            <a key={b.id} href={apiPath(`/buildings/${b.id}`)} style={{ textDecoration: "none" }}>
              <div className="iipe-card" style={{ height: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
                <div className="iipe-row" style={{ alignItems: "flex-start" }}>
                  <div style={{ minWidth: 0 }}>
                    <h3 style={{ margin: 0 }}>{b.name}</h3>
                    {b.code && <div className="iipe-muted" style={{ fontSize: "0.85rem" }}>{b.code}</div>}
                  </div>
                  <span className="iipe-spacer" />
                  <span className="iipe-badge">{b.facilities.length} facility{b.facilities.length === 1 ? "" : "ies"}</span>
                </div>
                {b.description && <p className="iipe-muted" style={{ margin: 0, fontSize: "0.92rem" }}>{b.description}</p>}
                {b.location && <div className="iipe-muted" style={{ fontSize: "0.85rem" }}>📍 {b.location}</div>}
                <div className="iipe-muted" style={{ fontSize: "0.82rem", marginTop: "auto" }}>
                  Today (IST): {istDateKey()} · open from {fmtMin(0)} IST
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </AppShell>
  );
}
