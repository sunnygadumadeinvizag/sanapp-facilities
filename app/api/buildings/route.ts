import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentUser, isAdmin } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const all = new URL(request.url).searchParams.get("all") === "1" && (await isAdmin());

  const buildings = await prisma.building.findMany({
    where: all ? {} : { active: true },
    orderBy: [{ order: "asc" }, { name: "asc" }],
    include: {
      facilities: {
        where: all ? {} : { active: true },
        select: { id: true, name: true, active: true },
      },
    },
  });
  return NextResponse.json({ buildings });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({} as Record<string, unknown>));

  if ((body as { op?: string })?.op === "delete" && typeof (body as { id?: unknown }).id === "string") {
    if (!(await isAdmin())) {
      return NextResponse.json({ error: "Only the app administrator can manage buildings" }, { status: 403 });
    }
    const delId = String((body as { id: string }).id).trim();
    if (!delId) return NextResponse.json({ error: "id is required" }, { status: 400 });
    const facilityCount = await prisma.facility.count({ where: { buildingId: delId } });
    if (facilityCount > 0) {
      return NextResponse.json({ error: "Remove or move the facilities in this building first" }, { status: 409 });
    }
    try {
      await prisma.building.delete({ where: { id: delId } });
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code === "P2025") return NextResponse.json({ error: "Building not found" }, { status: 404 });
      throw e;
    }
    return NextResponse.json({ ok: true });
  }

  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Only the app administrator can manage buildings" }, { status: 403 });
  }
  const name = String((body as { name?: unknown }).name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Building name is required" }, { status: 400 });

  const building = await prisma.building.create({
    data: {
      name,
      code: (body as { code?: unknown }).code ? String((body as { code: string }).code).trim() || null : null,
      description: (body as { description?: unknown }).description
        ? String((body as { description: string }).description).trim() || null
        : null,
      location: (body as { location?: unknown }).location
        ? String((body as { location: string }).location).trim() || null
        : null,
      order: Number.isInteger((body as { order?: unknown }).order) ? Number((body as { order: number }).order) : 0,
    },
  });
  return NextResponse.json({ building }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Only the app administrator can manage buildings" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const id = String((body as { id?: unknown }).id ?? "").trim();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const b = body as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  if (typeof b.name === "string" && b.name.trim()) data.name = b.name.trim();
  if (typeof b.code === "string") data.code = b.code.trim() || null;
  if (typeof b.description === "string") data.description = b.description.trim() || null;
  if (typeof b.location === "string") data.location = b.location.trim() || null;
  if (Number.isInteger(b.order)) data.order = b.order as number;
  if (typeof b.active === "boolean") data.active = b.active;

  let building;
  try {
    building = await prisma.building.update({ where: { id }, data });
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === "P2025") return NextResponse.json({ error: "Building not found" }, { status: 404 });
    throw e;
  }
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
    return NextResponse.json({ error: "Remove or move the facilities in this building first" }, { status: 409 });
  }
  try {
    await prisma.building.delete({ where: { id } });
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === "P2025") return NextResponse.json({ error: "Building not found" }, { status: 404 });
    throw e;
  }
  return NextResponse.json({ ok: true });
}
