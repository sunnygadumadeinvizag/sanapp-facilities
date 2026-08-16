import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { canDecide, parseSlot, parsePositiveInt } from "@/lib/logistics";
import type { RequestStatus } from "@/generated/prisma/client";

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

const LIST_SELECT = {
  id: true,
  date: true,
  endDate: true,
  startMin: true,
  endMin: true,
  purpose: true,
  destination: true,
  passengers: true,
  status: true,
  remarks: true,
  decidedAt: true,
  createdAt: true,
  vehicle: { select: { id: true, name: true, type: true, registrationNo: true } },
  user: { select: { id: true, username: true, name: true } },
  decidedBy: { select: { id: true, username: true, name: true } },
} as const;

export async function GET(request: NextRequest) {
  const me = await currentUser();
  if (!me) return bad("unauthorized", 401);

  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") ?? "mine";
  const status = searchParams.get("status") ?? "";

  const canSeeAll = canDecide(me);
  const where: Record<string, unknown> = {};
  if (scope === "all" && canSeeAll) {
    if (status) where.status = status;
  } else {
    where.userId = me.id;
    if (status) where.status = status;
  }

  const requests = await prisma.vehicleRequest.findMany({
    where,
    select: LIST_SELECT,
    orderBy: [{ createdAt: "desc" }],
    take: 200,
  });
  return NextResponse.json({ requests, canDecide: canSeeAll });
}

export async function POST(request: NextRequest) {
  const me = await currentUser();
  if (!me) return bad("unauthorized", 401);

  const body = await request.json().catch(() => ({}));
  const vehicleId = String(body.vehicleId ?? "").trim();
  const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, active: true } });
  if (!vehicle) return bad("Please select a vehicle");
  if (vehicle.status === "RETIRED" || vehicle.status === "MAINTENANCE") {
    return bad(`This vehicle is currently ${vehicle.status.toLowerCase()} and cannot be requested`);
  }

  const slot = parseSlot(body);
  if (slot.error) return bad(slot.error);

  const purpose = String(body.purpose ?? "").trim();
  if (!purpose) return bad("Purpose is required");
  if (purpose.length > 1000) return bad("Purpose is too long");

  const destination = body.destination ? String(body.destination).trim().slice(0, 300) : null;
  const passengers = body.passengers ? parsePositiveInt(body.passengers) : null;
  if (body.passengers !== undefined && body.passengers !== null && body.passengers !== "" && !passengers) {
    return bad("Passengers must be a positive number");
  }

  const req = await prisma.vehicleRequest.create({
    data: {
      vehicleId,
      userId: me.id,
      date: slot.slot!.date,
      endDate: slot.slot!.endDate,
      startMin: slot.slot!.startMin,
      endMin: slot.slot!.endMin,
      purpose,
      destination,
      passengers,
    },
    select: LIST_SELECT,
  });
  return NextResponse.json({ request: req }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const me = await currentUser();
  if (!me) return bad("unauthorized", 401);

  const body = await request.json().catch(() => ({}));
  const id = String(body.id ?? "");
  const action = String(body.action ?? "");
  if (!id) return bad("id is required");

  const existing = await prisma.vehicleRequest.findUnique({ where: { id }, include: { user: true } });
  if (!existing) return bad("Request not found", 404);

  // The requester may cancel their own request while it is pending/approved.
  if (action === "cancel") {
    if (existing.userId !== me.id) return bad("You can only cancel your own requests", 403);
    if (!["PENDING", "APPROVED"].includes(existing.status)) {
      return bad(`A ${existing.status.toLowerCase()} request cannot be cancelled`);
    }
    const updated = await prisma.vehicleRequest.update({
      where: { id },
      data: { status: "CANCELLED", remarks: body.remarks ? String(body.remarks).trim().slice(0, 500) : existing.remarks, decidedById: me.id, decidedAt: new Date() },
      select: LIST_SELECT,
    });
    return NextResponse.json({ request: updated });
  }

  // Decisions (approve / reject / complete) are for the app admin / logistics POC.
  if (!canDecide(me)) return bad("Only the app admin or a logistics POC can decide requests", 403);

  const decisions: Record<string, RequestStatus> = {
    approve: "APPROVED",
    reject: "REJECTED",
    complete: "COMPLETED",
  };
  const nextStatus: RequestStatus | undefined = decisions[action];
  if (!nextStatus) return bad("Unknown action");
  if (nextStatus === "APPROVED" && !["PENDING"].includes(existing.status)) {
    return bad(`A ${existing.status.toLowerCase()} request cannot be approved`);
  }
  if (nextStatus === "REJECTED" && !["PENDING"].includes(existing.status)) {
    return bad(`A ${existing.status.toLowerCase()} request cannot be rejected`);
  }
  if (nextStatus === "COMPLETED" && !["APPROVED", "IN_USE"].includes(existing.status)) {
    return bad("Only an approved request can be completed");
  }

  const remarks = body.remarks ? String(body.remarks).trim().slice(0, 500) : existing.remarks;
  const updated = await prisma.vehicleRequest.update({
    where: { id },
    data: { status: nextStatus, remarks, decidedById: me.id, decidedAt: new Date() },
    select: LIST_SELECT,
  });
  return NextResponse.json({ request: updated });
}
