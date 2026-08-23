import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentUser, isAdmin } from "@/lib/auth";
import {
  addBuildingPoc,
  addFacilityPoc,
  removeBuildingPoc,
  removeFacilityPoc,
  resolveUserByUsername,
} from "@/lib/poc";

/**
 * POST /api/pocs  { scope: "building" | "facility", scopeId, username }
 * Adds a POC by username (resolved against the local users and the SSO
 * registry — the full user list is never displayed). A building POC is
 * automatically added as POC of every facility in that building.
 */
export async function POST(request: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Only the app administrator can manage POCs" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const scope = body.scope === "building" || body.scope === "facility" ? body.scope : null;
  const scopeId = String(body.scopeId ?? "").trim();
  const username = String(body.username ?? "").trim();
  if (!scope || !scopeId || !username) {
    return NextResponse.json({ error: "scope, scopeId and username are required" }, { status: 400 });
  }

  if (scope === "building") {
    const building = await prisma.building.findUnique({ where: { id: scopeId } });
    if (!building) return NextResponse.json({ error: "Building not found" }, { status: 404 });
  } else {
    const facility = await prisma.facility.findUnique({ where: { id: scopeId } });
    if (!facility) return NextResponse.json({ error: "Facility not found" }, { status: 404 });
  }

  const user = await resolveUserByUsername(username);
  if (!user) {
    return NextResponse.json(
      { error: `No user found for “${username}” — check the username in the SSO registry` },
      { status: 404 }
    );
  }

  if (scope === "building") await addBuildingPoc(scopeId, user.id);
  else await addFacilityPoc(scopeId, user.id);

  const pocs =
    scope === "building"
      ? await prisma.buildingPoc.findMany({
          where: { buildingId: scopeId },
          include: { user: { select: { id: true, name: true, username: true } } },
          orderBy: { createdAt: "asc" },
        })
      : await prisma.facilityPoc.findMany({
          where: { facilityId: scopeId },
          include: { user: { select: { id: true, name: true, username: true } } },
          orderBy: { createdAt: "asc" },
        });

  return NextResponse.json({ ok: true, pocs });
}

/** DELETE /api/pocs?scope=&scopeId=&userId= */
export async function DELETE(request: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Only the app administrator can manage POCs" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope");
  const scopeId = (searchParams.get("scopeId") ?? "").trim();
  const userId = (searchParams.get("userId") ?? "").trim();
  if (!(scope === "building" || scope === "facility") || !scopeId || !userId) {
    return NextResponse.json({ error: "scope, scopeId and userId are required" }, { status: 400 });
  }

  if (scope === "building") await removeBuildingPoc(scopeId, userId);
  else await removeFacilityPoc(scopeId, userId);

  const pocs =
    scope === "building"
      ? await prisma.buildingPoc.findMany({
          where: { buildingId: scopeId },
          include: { user: { select: { id: true, name: true, username: true } } },
          orderBy: { createdAt: "asc" },
        })
      : await prisma.facilityPoc.findMany({
          where: { facilityId: scopeId },
          include: { user: { select: { id: true, name: true, username: true } } },
          orderBy: { createdAt: "asc" },
        });

  return NextResponse.json({ ok: true, pocs });
}
