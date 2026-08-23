import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyAppSession } from "@/lib/session";
import { isAdminSession } from "@/lib/auth";
import { istDateKey } from "@/lib/ist";
import { AppShell } from "../../components/AppShell";
import { BuildingsAdmin } from "../../components/BuildingsAdmin";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function AdminBuildingsPage() {
  const store = await cookies();
  const session = store.get("app4_session")?.value ?? "";
  const me = await verifyAppSession(session);
  if (!me) {
    return <p className="iipe-container">Session not found.</p>;
  }
  const admin = await isAdminSession();

  if (!admin) {
    return (
      <AppShell me={me} active="admin-buildings">
        <h1 className="iipe-page-title">Buildings &amp; POCs</h1>
        <Card className="p-6">
          <h2 className="text-lg font-semibold">Administrator access required</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Only an app administrator can manage buildings and POCs.
          </p>
        </Card>
      </AppShell>
    );
  }

  const buildings = await prisma.building.findMany({
    orderBy: [{ order: "asc" }, { name: "asc" }],
    include: {
      facilities: { select: { id: true, name: true, active: true } },
      pocs: {
        include: { user: { select: { id: true, name: true, username: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  return (
    <AppShell me={me} active="admin-buildings">
      <h1 className="iipe-page-title">Buildings &amp; POCs</h1>
      <p className="iipe-page-sub">
        Add buildings and set their default booking caps. A building POC automatically becomes POC
        of every facility in that building — including facilities added later.
      </p>
      <BuildingsAdmin initialBuildings={JSON.parse(JSON.stringify(buildings))} today={istDateKey()} />
    </AppShell>
  );
}
