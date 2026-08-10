import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentUser, isAdmin } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const buildingId = searchParams.get("buildingId");
  const facilities = await prisma.facility.findMany({
    where: buildingId ? { buildingId, active: true } : { active: true },
    orderBy: { name: "asc" },
    include: { building: { select: { id: true, name: true } } },
  });
  return NextResponse.json({ facilities });
}

export async function POST(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Only the app administrator can manage facilities" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const buildingId = String(body.buildingId ?? "").trim();
  const name = String(body.name ?? "").trim();
  if (!buildingId || !name) {
    return NextResponse.json({ error: "buildingId and facility name are required" }, { status: 400 });
  }

  const building = await prisma.building.findUnique({ where: { id: buildingId } });
  if (!building) {
    return NextResponse.json({ error: "Building not found" }, { status: 404 });
  }

  const allowedRoles = Array.isArray(body.allowedRoles)
    ? body.allowedRoles.map(String).filter(Boolean)
    : [];

  const facility = await prisma.facility.create({
    data: {
      buildingId,
      name,
      description: body.description ? String(body.description).trim() : null,
      capacity: Number.isInteger(body.capacity) && Number(body.capacity) > 0 ? Number(body.capacity) : null,
      allowedRoles,
    },
  });
  return NextResponse.json({ facility }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Only the app administrator can manage facilities" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const id = String(body.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (typeof body.description === "string") data.description = body.description.trim() || null;
  if (typeof body.capacity === "number" || body.capacity === null) {
    data.capacity = Number.isInteger(body.capacity) && body.capacity > 0 ? body.capacity : null;
  }
  if (Array.isArray(body.allowedRoles)) {
    data.allowedRoles = body.allowedRoles.map(String).filter(Boolean);
  }
  if (typeof body.active === "boolean") data.active = body.active;

  const facility = await prisma.facility.update({ where: { id }, data });
  return NextResponse.json({ facility });
}

export async function DELETE(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Only the app administrator can manage facilities" }, { status: 403 });
  }
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const bookingCount = await prisma.booking.count({ where: { facilityId: id, status: "CONFIRMED" } });
  if (bookingCount > 0) {
    return NextResponse.json(
      { error: "This facility has active bookings — cancel them before disabling it" },
      { status: 409 }
    );
  }
  await prisma.facility.update({ where: { id }, data: { active: false } });
  return NextResponse.json({ ok: true });
}
