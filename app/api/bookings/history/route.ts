import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { bookingHistory } from "@/lib/notify";

/**
 * GET /api/bookings/history?bookingId=...&code=...
 *
 * The full life-cycle history (created / edited / cancelled) of one booking.
 * A "booking" is a submission group: every slot sharing the batchId/code is
 * included, and events of all its slots are returned together.
 *
 * Access: an app ADMIN, or a user who is the booker / blocked-for user of at
 * least one slot in the group (the booker can review their own edit history).
 */
export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const bookingId = (sp.get("bookingId") ?? "").trim();
  const code = (sp.get("code") ?? "").trim();
  if (!bookingId && !code) {
    return NextResponse.json({ error: "bookingId or code is required" }, { status: 400 });
  }

  // Resolve the submission group.
  const anchor = bookingId
    ? await prisma.booking.findUnique({ where: { id: bookingId } })
    : await prisma.booking.findFirst({ where: { code } });
  if (!anchor) return NextResponse.json({ error: "Booking not found" }, { status: 404 });

  // The display code lives on the first slot of the submission group.
  const anchorCode = anchor.code
    ?? (
      await prisma.booking.findFirst({
        where: { batchId: anchor.batchId ?? anchor.id, code: { not: null } },
        select: { code: true },
        orderBy: { createdAt: "asc" },
      })
    )?.code
    ?? null;
  const groupKey = anchorCode ?? anchor.batchId ?? anchor.id;
  const slots = await prisma.booking.findMany({
    where: { OR: [{ batchId: anchor.batchId ?? anchor.id }, { code: anchor.code ?? undefined }] },
    select: {
      id: true,
      code: true,
      batchId: true,
      date: true,
      endDate: true,
      startMin: true,
      endMin: true,
      status: true,
      needAvSupport: true,
      purpose: true,
      userId: true,
      forUserId: true,
    },
    orderBy: [{ date: "asc" }, { startMin: "asc" }],
  });

  // Authorization — admin, booker or blocked-for user.
  const isAdmin = user.role === "ADMIN";
  const involved = slots.some((s) => s.userId === user.id || s.forUserId === user.id);
  if (!isAdmin && !involved) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const events = await bookingHistory(anchor.id);
  // Group events across ALL slots of the submission when the anchor is a batch.
  const allEvents = slots.length > 1
    ? (await Promise.all(slots.map((s) => bookingHistory(s.id)))).flat()
    : events;

  allEvents.sort((a, b) => (a.at.getTime() < b.at.getTime() ? -1 : a.at.getTime() > b.at.getTime() ? 1 : 0));

  return NextResponse.json({
    bookingCode: groupKey,
    slots: slots.map((s) => ({
      id: s.id,
      date: s.date,
      endDate: s.endDate || s.date,
      startMin: s.startMin,
      endMin: s.endMin,
      status: s.status,
      needAvSupport: s.needAvSupport,
    })),
    events: allEvents.map((e) => ({
      id: e.id,
      kind: e.kind,
      at: e.at,
      actorName: e.actorName,
      actorUsername: e.actorUsername,
      changes: e.changes ? (JSON.parse(e.changes) as unknown) : null,
      reason: e.reason,
    })),
  });
}
