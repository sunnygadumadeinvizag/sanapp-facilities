import { cookies } from "next/headers";
import { verifyAppSession } from "@/lib/session";
import { AppShell } from "../components/AppShell";
import { MyBookingsClient } from "../components/MyBookingsClient";
import { istDateKey } from "@/lib/ist";

export const dynamic = "force-dynamic";

export default async function MyBookingsPage() {
  const store = await cookies();
  const session = store.get("app4_session")?.value ?? "";
  const me = await verifyAppSession(session);
  if (!me) {
    return <p className="iipe-container">Session not found.</p>;
  }

  return (
    <AppShell
      me={me}
      active="home"
      sidebarItems={[
        { label: "Facilities Home", href: "/" },
        { label: "My Bookings", href: "/my-bookings", active: true },

      ]}
    >
      <h1 className="iipe-page-title">My Bookings</h1>
      <p className="iipe-page-sub">
        Every slot is Indian Standard Time (IST). You can cancel a booking until
        its start time is reached.
      </p>
      <MyBookingsClient today={istDateKey()} canEdit />
    </AppShell>
  );
}
