import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { canDecide, parseSlot } from "@/lib/logistics";
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
  vehicleNo: true,
  purpose: true,
  status: true,
  remarks: true,
  decidedAt: true,
  createdAt: true,
  slot: { select: { id: true, name: true, area: true, slotType: true } },
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

  const requests = await prisma.parkingRequest.findMany({
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
  const slotId = String(body.slotId ?? "").trim();
  const slot = await prisma.parkingSlot.findFirst({ where: { id: slotId, active: true } });
  if (!slot) return bad("Please select a parking slot");

  const slotRes = parseSlot(body);
  if (slotRes.error) return bad(slotRes.error);

  const vehicleNo = String(body.vehicleNo ?? "").trim();
  if (!vehicleNo) return bad("Vehicle registration number is required");
  if (vehicleNo.length > 30) return bad("Vehicle number is too long");

  const purpose = body.purpose ? String(body.purpose).trim().slice(0, 1000) : null;

  const req = await prisma.parkingRequest.create({
    data: {
      slotId,
      userId: me.id,
      vehicleNo,
      date: slotRes.slot!.date,
      endDate: slotRes.slot!.endDate,
      startMin: slotRes.slot!.startMin,
      endMin: slotRes.slot!.endMin,
      purpose,
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

  const existing = await prisma.parkingRequest.findUnique({ where: { id } });
  if (!existing) return bad("Request not found", 404);

  if (action === "cancel") {
    if (existing.userId !== me.id) return bad("You can only cancel your own requests", 403);
    if (!["PENDING", "APPROVED"].includes(existing.status)) {
      return bad(`A ${existing.status.toLowerCase()} request cannot be cancelled`);
    }
    const updated = await prisma.parkingRequest.update({
      where: { id },
      data: { status: "CANCELLED", remarks: body.remarks ? String(body.remarks).trim().slice(0, 500) : existing.remarks, decidedById: me.id, decidedAt: new Date() },
      select: LIST_SELECT,
    });
    return NextResponse.json({ request: updated });
  }

  if (!canDecide(me)) return bad("Only the app admin or a logistics POC can decide requests", 403);

  const decisions: Record<string, RequestStatus> = {
    approve: "APPROVED",
    reject: "REJECTED",
    complete: "COMPLETED",
  };
  const nextStatus: RequestStatus | undefined = decisions[action];
  if (!nextStatus) return bad("Unknown action");
  if (nextStatus === "APPROVED" && existing.status !== "PENDING") {
    return bad(`A ${existing.status.toLowerCase()} request cannot be approved`);
  }
  if (nextStatus === "REJECTED" && existing.status !== "PENDING") {
    return bad(`A ${existing.status.toLowerCase()} request cannot be rejected`);
  }
  if (nextStatus === "COMPLETED" && existing.status !== "APPROVED") {
    return bad("Only an approved request can be completed");
  }

  const remarks = body.remarks ? String(body.remarks).trim().slice(0, 500) : existing.remarks;
  const updated = await prisma.parkingRequest.update({
    where: { id },
    data: { status: nextStatus, remarks, decidedById: me.id, decidedAt: new Date() },
    select: LIST_SELECT,
  });
  return NextResponse.json({ request: updated });
}
