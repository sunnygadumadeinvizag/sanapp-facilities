import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyAppSession } from "@/lib/session";
import { istDateKey } from "@/lib/ist";
import { AppShell } from "../components/AppShell";
import { AdminClient } from "../components/AdminClient";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const store = await cookies();
  const session = store.get("app4_session")?.value ?? "";
  const me = await verifyAppSession(session);
  if (!me) {
    return <p className="iipe-container">Session not found.</p>;
  }
  const local = await prisma.appUser.findUnique({ where: { username: me.username } });
  const isAdmin = local?.role === "ADMIN";

  return (
    <AppShell me={me} active="admin">
      <h1 className="iipe-page-title">App Administration</h1>
      <p className="iipe-page-sub">
        Manage buildings, facilities, who may book them (by primary role), and
        the users with approval access / POC designation.
      </p>
      <AdminClient isAdmin={isAdmin} today={istDateKey()} />
    </AppShell>
  );
}
