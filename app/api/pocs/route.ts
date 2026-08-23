import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentUser, isAdmin } from "@/lib/auth";
import { addFacilityPoc, removeFacilityPoc, resolveUserByUsername } from "@/lib/poc";

export async function POST(request: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Only the app administrator can manage POCs" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  if ((body as { scope?: string })?.scope === "building") {
    return NextResponse.json({ error: "POCs are managed per facility" }, { status: 400 });
  }
  const scopeId = String((body as { scopeId?: unknown }).scopeId ?? "").trim();
  const username = String((body as { username?: unknown }).username ?? "").trim();
  if (!scopeId || !username) {
    return NextResponse.json({ error: "scopeId and username are required" }, { status: 400 });
  }

  const facility = await prisma.facility.findUnique({ where: { id: scopeId } });
  if (!facility) return NextResponse.json({ error: "Facility not found" }, { status: 404 });

  const user = await resolveUserByUsername(username);
  if (!user) {
    return NextResponse.json(
      { error: `No user found for “${username}” — check the username in the SSO registry` },
      { status: 404 }
    );
  }

  await addFacilityPoc(scopeId, user.id);

  const pocs = await prisma.facilityPoc.findMany({
    where: { facilityId: scopeId },
    include: { user: { select: { id: true, name: true, username: true } } },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ ok: true, pocs });
}

async function handlePocDelete(scopeId: string, userId: string) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Only the app administrator can manage POCs" }, { status: 403 });
  }
  if (!scopeId || !userId) {
    return NextResponse.json({ error: "scopeId and userId are required" }, { status: 400 });
  }
  await removeFacilityPoc(scopeId, userId);
  const pocs = await prisma.facilityPoc.findMany({
    where: { facilityId: scopeId },
    include: { user: { select: { id: true, name: true, username: true } } },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ ok: true, pocs });
}

export async function DELETE(request: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { searchParams } = new URL(request.url);
  if (searchParams.get("scope") === "building") {
    return NextResponse.json({ error: "POCs are managed per facility" }, { status: 400 });
  }
  const scopeId = (searchParams.get("scopeId") ?? "").trim();
  const userId = (searchParams.get("userId") ?? "").trim();
  return handlePocDelete(scopeId, userId);
}
