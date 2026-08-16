import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentUser, isAdmin } from "@/lib/auth";

const VEHICLE_STATUSES = ["AVAILABLE", "IN_USE", "MAINTENANCE", "RETIRED"] as const;

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET() {
  const user = await currentUser();
  if (!user) return bad("unauthorized", 401);
  const admin = user.role === "ADMIN";
  const vehicles = await prisma.vehicle.findMany({
    where: admin ? {} : { active: true },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    include: {
      _count: { select: { requests: { where: { status: { in: ["PENDING", "APPROVED"] } } } } },
    },
  });
  return NextResponse.json({ vehicles });
}

export async function POST(request: NextRequest) {
  if (!(await isAdmin())) return bad("Only the app administrator can add vehicles", 403);
  const body = await request.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  const type = String(body.type ?? "").trim();
  const registrationNo = String(body.registrationNo ?? "").trim();
  if (!name || !type || !registrationNo) {
    return bad("Name, type and registration number are required");
  }
  const capacity = body.capacity ? Math.round(Number(body.capacity)) : null;
  if (capacity !== null && (!Number.isFinite(capacity) || capacity < 1 || capacity > 100)) {
    return bad("Capacity must be between 1 and 100");
  }
  const vehicle = await prisma.vehicle.create({
    data: {
      name,
      type,
      registrationNo,
      capacity,
      driverName: body.driverName ? String(body.driverName).trim() : null,
      driverPhone: body.driverPhone ? String(body.driverPhone).trim() : null,
      notes: body.notes ? String(body.notes).trim() : null,
    },
  });
  return NextResponse.json({ vehicle }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  if (!(await isAdmin())) return bad("Only the app administrator can edit vehicles", 403);
  const body = await request.json().catch(() => ({}));
  const id = String(body.id ?? "");
  if (!id) return bad("id is required");
  const existing = await prisma.vehicle.findUnique({ where: { id } });
  if (!existing) return bad("Vehicle not found", 404);

  const data: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (typeof body.type === "string" && body.type.trim()) data.type = body.type.trim();
  if (typeof body.registrationNo === "string" && body.registrationNo.trim()) {
    data.registrationNo = body.registrationNo.trim();
  }
  if (body.capacity !== undefined && body.capacity !== null && body.capacity !== "") {
    const capacity = Math.round(Number(body.capacity));
    if (!Number.isFinite(capacity) || capacity < 1 || capacity > 100) {
      return bad("Capacity must be between 1 and 100");
    }
    data.capacity = capacity;
  } else {
    data.capacity = null;
  }
  data.driverName = typeof body.driverName === "string" && body.driverName.trim() ? body.driverName.trim() : null;
  data.driverPhone = typeof body.driverPhone === "string" && body.driverPhone.trim() ? body.driverPhone.trim() : null;
  data.notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;
  if (typeof body.status === "string" && (VEHICLE_STATUSES as readonly string[]).includes(body.status)) {
    data.status = body.status;
  }
  if (typeof body.active === "boolean") data.active = body.active;

  const vehicle = await prisma.vehicle.update({ where: { id }, data });
  return NextResponse.json({ vehicle });
}

export async function DELETE(request: NextRequest) {
  if (!(await isAdmin())) return bad("Only the app administrator can remove vehicles", 403);
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id") ?? "";
  const existing = await prisma.vehicle.findUnique({ where: { id } });
  if (!existing) return bad("Vehicle not found", 404);
  await prisma.vehicle.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
