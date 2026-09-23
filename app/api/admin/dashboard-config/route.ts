import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdminSession } from "@/lib/auth";

const CONFIG_ID = "default";

/** Facility ids from the request body (validated: must exist). */
function facilityIdList(value: unknown): string[] {
  const arr = Array.isArray(value) ? value.map((v) => String(v ?? "").trim()) : [];
  return [...new Set(arr.filter(Boolean))].slice(0, 200);
}

/** Usernames allowed to SEE the dashboard (empty = every app admin). */
function usernameList(value: unknown): string[] {
  const arr = Array.isArray(value)
    ? value.map((v) => String(v ?? "").trim().toLowerCase())
    : typeof value === "string"
      ? value.split(/[\n,;]+/).map((v) => v.trim().toLowerCase())
      : [];
  return [...new Set(arr.filter(Boolean))].slice(0, 100);
}

/**
 * GET /api/admin/dashboard-config — the current dashboard configuration
 * (which facilities are shown, which admins may view it). Super-admin gated.
 */
export async function GET() {
  if (!(await isAdminSession())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const config = await prisma.dashboardConfig.findUnique({ where: { id: CONFIG_ID } });
  return NextResponse.json({
    facilityIds: config?.facilityIds ?? [],
    allowedUsernames: config?.allowedUsernames ?? [],
  });
}

/**
 * PUT /api/admin/dashboard-config — save the configuration.
 * Body: { facilityIds: string[], allowedUsernames: string[] | string }
 * (allowedUsernames empty = visible to every app admin).
 */
export async function PUT(request: NextRequest) {
  if (!(await isAdminSession())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const facilityIds = facilityIdList(body.facilityIds);
  if (facilityIds.length > 0) {
    const known = await prisma.facility.findMany({
      where: { id: { in: facilityIds } },
      select: { id: true },
    });
    const knownSet = new Set(known.map((f) => f.id));
    const unknown = facilityIds.filter((f) => !knownSet.has(f));
    if (unknown.length > 0) {
      return NextResponse.json({ error: `Unknown facility id(s): ${unknown.join(", ")}` }, { status: 400 });
    }
  }

  const allowedUsernames = usernameList(body.allowedUsernames);
  if (allowedUsernames.length > 0) {
    const known = await prisma.appUser.findMany({
      where: { username: { in: allowedUsernames }, role: "ADMIN" },
      select: { username: true },
    });
    const knownSet = new Set(known.map((u) => u.username));
    const notAdmin = allowedUsernames.filter((u) => !knownSet.has(u));
    if (notAdmin.length > 0) {
      return NextResponse.json(
        { error: `These usernames are not app admins: ${notAdmin.join(", ")}` },
        { status: 400 }
      );
    }
  }

  const saved = await prisma.dashboardConfig.upsert({
    where: { id: CONFIG_ID },
    update: { facilityIds, allowedUsernames },
    create: { id: CONFIG_ID, facilityIds, allowedUsernames },
  });
  return NextResponse.json({
    facilityIds: saved.facilityIds,
    allowedUsernames: saved.allowedUsernames,
  });
}
