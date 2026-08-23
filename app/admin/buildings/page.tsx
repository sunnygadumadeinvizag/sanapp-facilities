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
        <h1 className="iipe-page-title">Buildings</h1>
        <Card className="p-6">
          <h2 className="text-lg font-semibold">Administrator access required</h2>
          <p className="mt-2 text-sm text-muted-foreground">Only an app administrator can manage buildings.</p>
        </Card>
      </AppShell>
    );
  }

  let buildings: Awaited<ReturnType<typeof prisma.building.findMany>>;
  try {
    buildings = await prisma.building.findMany({
      orderBy: [{ order: "asc" }, { name: "asc" }],
      include: {
        facilities: { select: { id: true, name: true, active: true } },
      },
    });
  } catch {
    return (
      <AppShell me={me} active="admin-buildings">
        <h1 className="iipe-page-title">Buildings</h1>
        <Card className="p-6">
          <p className="text-sm text-red-700">Could not load buildings. Please reload the page.</p>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell me={me} active="admin-buildings">
      <h1 className="iipe-page-title">Buildings</h1>
      <p className="iipe-page-sub">Add and manage buildings. Facilities are managed on the next page.</p>
      <BuildingsAdmin initialBuildings={JSON.parse(JSON.stringify(buildings))} today={istDateKey()} />
    </AppShell>
  );
}
