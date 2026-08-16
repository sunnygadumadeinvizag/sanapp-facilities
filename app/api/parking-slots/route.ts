import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentUser, isAdmin } from "@/lib/auth";

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET() {
  const user = await currentUser();
  if (!user) return bad("unauthorized", 401);
  const admin = user.role === "ADMIN";
  const slots = await prisma.parkingSlot.findMany({
    where: admin ? {} : { active: true },
    orderBy: [{ area: "asc" }, { name: "asc" }],
  });
  return NextResponse.json({ slots });
}

export async function POST(request: NextRequest) {
  if (!(await isAdmin())) return bad("Only the app administrator can add parking slots", 403);
  const body = await request.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  if (!name) return bad("Slot name is required");
  const slot = await prisma.parkingSlot.create({
    data: {
      name,
      area: body.area ? String(body.area).trim() : null,
      slotType: body.slotType === "RESERVED" ? "RESERVED" : "GENERAL",
      notes: body.notes ? String(body.notes).trim() : null,
    },
  });
  return NextResponse.json({ slot }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  if (!(await isAdmin())) return bad("Only the app administrator can edit parking slots", 403);
  const body = await request.json().catch(() => ({}));
  const id = String(body.id ?? "");
  if (!id) return bad("id is required");
  const existing = await prisma.parkingSlot.findUnique({ where: { id } });
  if (!existing) return bad("Parking slot not found", 404);

  const data: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (body.area !== undefined) data.area = body.area ? String(body.area).trim() : null;
  if (body.slotType === "RESERVED" || body.slotType === "GENERAL") data.slotType = body.slotType;
  if (body.notes !== undefined) data.notes = body.notes ? String(body.notes).trim() : null;
  if (typeof body.active === "boolean") data.active = body.active;

  const slot = await prisma.parkingSlot.update({ where: { id }, data });
  return NextResponse.json({ slot });
}

export async function DELETE(request: NextRequest) {
  if (!(await isAdmin())) return bad("Only the app administrator can remove parking slots", 403);
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id") ?? "";
  const existing = await prisma.parkingSlot.findUnique({ where: { id } });
  if (!existing) return bad("Parking slot not found", 404);
  await prisma.parkingSlot.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
