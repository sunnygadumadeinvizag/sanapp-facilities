import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyAppSession } from "@/lib/session";
import { isAdminSession } from "@/lib/auth";
import { AppShell } from "../../components/AppShell";
import { FacilitiesAdmin } from "../../components/FacilitiesAdmin";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function AdminFacilitiesPage() {
  const store = await cookies();
  const session = store.get("app4_session")?.value ?? "";
  const me = await verifyAppSession(session);
  if (!me) {
    return <p className="iipe-container">Session not found.</p>;
  }
  const admin = await isAdminSession();

  if (!admin) {
    return (
      <AppShell me={me} active="admin-facilities">
        <h1 className="iipe-page-title">Facilities &amp; POCs</h1>
        <Card className="p-6">
          <h2 className="text-lg font-semibold">Administrator access required</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Only an app administrator can manage facilities and POCs.
          </p>
        </Card>
      </AppShell>
    );
  }

  let buildings: Awaited<ReturnType<typeof prisma.building.findMany>>;
  try {
    buildings = await prisma.building.findMany({
      orderBy: [{ order: "asc" }, { name: "asc" }],
      include: {
        facilities: {
          orderBy: { name: "asc" },
          include: {
            roleLimits: { select: { role: true, maxMinutes: true } },
            pocs: {
              include: { user: { select: { id: true, name: true, username: true } } },
              orderBy: { createdAt: "asc" },
            },
          },
        },
      },
    });
  } catch {
    return (
      <AppShell me={me} active="admin-facilities">
        <h1 className="iipe-page-title">Facilities &amp; POCs</h1>
        <Card className="p-6">
          <p className="text-sm text-red-700">Could not load facilities. Please reload the page.</p>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell me={me} active="admin-facilities">
      <h1 className="iipe-page-title">Facilities &amp; POCs</h1>
      <p className="iipe-page-sub">Pick a building to manage its facilities — booking caps, who may book, and facility-level POCs.</p>
      <FacilitiesAdmin initialBuildings={JSON.parse(JSON.stringify(buildings))} />
    </AppShell>
  );
}
