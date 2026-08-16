import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyAppSession } from "@/lib/session";
import { AppShell } from "../components/AppShell";
import { VehiclesClient } from "../components/VehiclesClient";
import { istDateKey } from "@/lib/ist";

export const dynamic = "force-dynamic";

export default async function VehiclesPage() {
  const store = await cookies();
  const session = store.get("app4_session")?.value ?? "";
  const me = await verifyAppSession(session);
  if (!me) {
    redirect(process.env.APP_BASE_URL! + "/api/start-oauth");
  }

  return (
    <AppShell
      me={me}
      active="home"
      sidebarItems={[
        { label: "Facilities Home", href: "/" },
        { label: "My Bookings", href: "/my-bookings" },
        { label: "Vehicle Requests", href: "/vehicles", active: true },
        { label: "Parking Requests", href: "/parking" },
        { label: "My Account", href: `${process.env.SSO_BASE_URL}/account` },
      ]}
    >
      <h1 className="iipe-page-title">Vehicle Requests</h1>
      <p className="iipe-page-sub">
        Request institute vehicles (Logistics section). Submit your requirement with an IST
        slot — the logistics POC / app admin approves it. All times are{" "}
        <strong>Indian Standard Time (IST)</strong>, server time.
      </p>
      <VehiclesClient today={istDateKey()} />
    </AppShell>
  );
}
