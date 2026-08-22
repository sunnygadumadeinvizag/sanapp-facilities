import { cookies } from "next/headers";
import { verifyAppSession } from "@/lib/session";
import { AppShell } from "../components/AppShell";
import { AppNotificationsView } from "sanapp-common-ui";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const store = await cookies();
  const session = store.get("app4_session")?.value ?? "";
  const me = await verifyAppSession(session);
  if (!me) {
    return <p className="iipe-container">Session not found.</p>;
  }

  return (
    <AppShell me={me} active="notifications" sidebarItems={[]}>
      <h1 className="iipe-page-title">App Notifications</h1>
      <p className="iipe-page-sub">
        Alerts from Facilities Booking — confirmations, changes and cancellations. Notifications
        from every application also appear under the bell in the header.
      </p>
      <div className="mt-4">
        <AppNotificationsView appName="Facilities Booking" />
      </div>
    </AppShell>
  );
}
