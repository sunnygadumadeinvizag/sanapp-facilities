import { cookies } from "next/headers";
import { verifyAppSession } from "@/lib/session";
import { isAdminSession } from "@/lib/auth";
import { istDateKey } from "@/lib/ist";
import { AppShell } from "../../components/AppShell";
import { AdminBookingsTab } from "../../components/AdminBookingsTab";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function AdminAllBookingsPage() {
  const store = await cookies();
  const session = store.get("app4_session")?.value ?? "";
  const me = await verifyAppSession(session);
  if (!me) {
    return <p className="iipe-container">Session not found.</p>;
  }
  const admin = await isAdminSession();

  if (!admin) {
    return (
      <AppShell me={me} active="admin-bookings">
        <h1 className="iipe-page-title">All Bookings</h1>
        <Card className="p-6">
          <h2 className="text-lg font-semibold">Administrator access required</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Only an app administrator can view every booking.
          </p>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell me={me} active="admin-bookings">
      <h1 className="iipe-page-title">All Bookings</h1>
      <p className="iipe-page-sub">
        Track every booking across all buildings and facilities — filter by user (searched by
        username, never a full listing), building, facility, date range or status.
      </p>
      <AdminBookingsTab today={istDateKey()} />
    </AppShell>
  );
}
