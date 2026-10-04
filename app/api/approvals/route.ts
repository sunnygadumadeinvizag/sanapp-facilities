import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import {
  decideBooking,
  decidableFacilityIds,
  listPendingApprovals,
  listRecentDecisions,
} from "@/lib/approval";
import { sendApprovalMail } from "@/lib/approval-mail";
import { sendBookingDigest, type NotifyBooking } from "@/lib/notify";

/**
 * The approval queue of a facility that requires an approval.
 *
 * GET  → the requests waiting for this user's decision, plus what they decided
 *        recently, scoped to the facilities they approve for.
 * POST → approve or decline one request (all slots it was raised for).
 *
 * Who may decide is decided in src/lib/approval.ts: the facility's approval
 * people, its POCs and the POCs of its building, plus app ADMINs.
 */

export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const facilityFilter = (request.nextUrl.searchParams.get("facilityId") ?? "").trim();
  const scope = await decidableFacilityIds(user.id, user.role);
  if (scope !== "all" && scope.length === 0) {
    return NextResponse.json({ pending: [], decided: [], facilities: [], canDecide: false });
  }

  const [pending, decided] = await Promise.all([
    listPendingApprovals(scope, { facilityId: facilityFilter || undefined }),
    listRecentDecisions(scope),
  ]);

  // The facility list of the filter dropdown: everything this user may decide.
  const facilities = await prisma.facility.findMany({
    where: scope === "all" ? {} : { id: { in: scope } },
    select: { id: true, name: true, building: { select: { name: true } } },
    orderBy: [{ building: { name: "asc" } }, { name: "asc" }],
  });

  return NextResponse.json({
    pending,
    decided,
    facilities: facilities.map((f) => ({
      id: f.id,
      name: f.name,
      buildingName: f.building.name,
    })),
    canDecide: true,
  });
}

export async function POST(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const decision = body.decision === "decline" ? "decline" : "approve";
  const note = typeof body.note === "string" ? body.note : null;
  const bookingIds = Array.isArray(body.bookingIds)
    ? (body.bookingIds as unknown[]).map((v) => String(v ?? ""))
    : typeof body.bookingId === "string"
      ? [body.bookingId]
      : [];

  const result = await decideBooking({
    bookingIds,
    decision,
    note,
    actor: { id: user.id, name: user.name, username: user.username, role: user.role },
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // Tell the requester the outcome — always, whatever the facility's notifier
  // configuration says, because this is the decision they are waiting on.
  const anchor = result.bookings[0];
  const booking: NotifyBooking = {
    id: anchor.id,
    code: anchor.code,
    batchId: anchor.batchId,
    facilityId: anchor.facilityId,
    needAvSupport: anchor.needAvSupport,
    purpose: anchor.purpose,
    status: anchor.status,
    facility: { name: anchor.facilityName, building: { name: anchor.buildingName } },
    user: { name: anchor.bookerName, username: anchor.bookerUsername },
    forUser: anchor.forName
      ? { name: anchor.forName, username: anchor.forUsername ?? "" }
      : null,
  };

  await sendApprovalMail({
    booking,
    kind: decision === "approve" ? "approved" : "declined",
    note,
    decidedBy: `${user.name} (@${user.username})`,
  });

  // An approved slot is a new confirmed booking for the facility, so its
  // notifier list is refreshed — the requester has just been mailed directly,
  // so the digest is limited to the notifiers and never doubles up.
  if (decision === "approve") {
    void sendBookingDigest({ booking, onlyNotifiers: true });
  }

  return NextResponse.json({
    decision,
    bookings: result.bookings,
    message:
      decision === "approve"
        ? result.bookings.length === 1
          ? "Request approved — the slot is now confirmed and the requester has been told"
          : `${result.bookings.length} slots approved and confirmed`
        : result.bookings.length === 1
          ? "Request declined — the slot is free again and the requester has been told"
          : `${result.bookings.length} slots declined`,
  });
}
