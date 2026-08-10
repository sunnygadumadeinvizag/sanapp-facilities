import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentUser, isAdmin } from "@/lib/auth";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const buildings = await prisma.building.findMany({
    where: { active: true },
    orderBy: [{ order: "asc" }, { name: "asc" }],
    include: {
      facilities: {
        where: { active: true },
        select: { id: true, name: true },
      },
    },
  });
  return NextResponse.json({ buildings });
}

export async function POST(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Only the app administrator can manage buildings" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Building name is required" }, { status: 400 });

  const building = await prisma.building.create({
    data: {
      name,
      code: body.code ? String(body.code).trim() : null,
      description: body.description ? String(body.description).trim() : null,
      location: body.location ? String(body.location).trim() : null,
      order: Number.isInteger(body.order) ? Number(body.order) : 0,
    },
  });
  return NextResponse.json({ building }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Only the app administrator can manage buildings" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const id = String(body.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (typeof body.code === "string") data.code = body.code.trim() || null;
  if (typeof body.description === "string") data.description = body.description.trim() || null;
  if (typeof body.location === "string") data.location = body.location.trim() || null;
  if (Number.isInteger(body.order)) data.order = body.order;
  if (typeof body.active === "boolean") data.active = body.active;

  const building = await prisma.building.update({ where: { id }, data });
  return NextResponse.json({ building });
}

export async function DELETE(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Only the app administrator can manage buildings" }, { status: 403 });
  }
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const facilityCount = await prisma.facility.count({ where: { buildingId: id } });
  if (facilityCount > 0) {
    return NextResponse.json(
      { error: "Remove or move the facilities in this building first" },
      { status: 409 }
    );
  }
  await prisma.building.update({ where: { id }, data: { active: false } });
  return NextResponse.json({ ok: true });
}
