import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyAppSession } from "@/lib/session";
import { AppShell } from "../components/AppShell";
import { ParkingClient } from "../components/ParkingClient";
import { istDateKey } from "@/lib/ist";

export const dynamic = "force-dynamic";

export default async function ParkingPage() {
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
        { label: "Vehicle Requests", href: "/vehicles" },
        { label: "Parking Requests", href: "/parking", active: true },
        { label: "My Account", href: `${process.env.SSO_BASE_URL}/account` },
      ]}
    >
      <h1 className="iipe-page-title">Parking Requests</h1>
      <p className="iipe-page-sub">
        Request a parking slot (Logistics section). Pick a slot and an IST period — the
        logistics POC / app admin approves it. All times are{" "}
        <strong>Indian Standard Time (IST)</strong>, server time.
      </p>
      <ParkingClient today={istDateKey()} />
    </AppShell>
  );
}
