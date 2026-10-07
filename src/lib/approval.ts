import { prisma } from "@/lib/prisma";
import { isPocOfFacility } from "@/lib/poc";
import { bookingCodeOf } from "@/lib/notify";

/**
 * Approval workflow for facilities with `requiresApproval`.
 *
 * A regular user's slot on such a facility is created as PENDING_APPROVAL: the
 * slot is held (it blocks overlapping requests, like a confirmed booking) but
 * nobody is told the slot is theirs yet. It becomes CONFIRMED only once an
 * approval person decides in its favour — and that is the moment the requester
 * and the facility's notifiers hear about it.
 *
 * Who may decide: the approval people configured on the facility, the POCs of
 * the facility / its building, and app ADMINs. The last two exist so a facility
 * keeps working even when nobody is configured as an approval person.
 */

export type ApprovalContext = {
  requiresApproval: boolean;
  isApprover: boolean;
  isPoc: boolean;
  isAdmin: boolean;
  /** admin || approver || POC — may decide, and books directly without waiting. */
  canDecide: boolean;
  /** This booking has to wait for a decision. */
  needsApproval: boolean;
};

/** True when the user is listed as an approval person of this facility. */
export async function isApproverOfFacility(userId: string, facilityId: string): Promise<boolean> {
  const row = await prisma.facilityApprover.findUnique({
    where: { facilityId_userId: { facilityId, userId } },
    select: { id: true },
  });
  return !!row;
}

export type FacilityAccess = {
  /** App ADMIN (a central SUPER_ADMIN is mapped to ADMIN when they sign in). */
  isAdmin: boolean;
  /** Listed as an approval person of THIS facility. */
  isApprover: boolean;
  /** POC of this facility, or of its building. */
  isPoc: boolean;
  /**
   * May decide requests AND manage what is personal to the facility — the
   * closed days, the bookable hours and the booking caps. An app admin, the
   * facility's approval people, and its POCs (who already run its calendar).
   */
  manages: boolean;
  /**
   * Books a slot directly, with no approval request: an app admin or one of the
   * facility's approval people. Everybody else — POCs included — raises a
   * request that waits for a decision, and the booking page says which of the
   * two applies in as many words, because a decider's own slot is confirmed the
   * moment they submit it.
   */
  booksDirectly: boolean;
};

/**
 * What this user may do on this facility: decide requests, book without asking,
 * and manage its bookable availability. One place, so the booking API, the
 * approvals queue and the availability editor can never disagree about it.
 */
export async function facilityAccess(
  facilityId: string,
  userId: string,
  role: string
): Promise<FacilityAccess> {
  const isAdmin = role === "ADMIN";
  const [isApprover, isPoc] = await Promise.all([
    isApproverOfFacility(userId, facilityId),
    isPocOfFacility(userId, facilityId),
  ]);
  return {
    isAdmin,
    isApprover,
    isPoc,
    manages: isAdmin || isApprover || isPoc,
    booksDirectly: isAdmin || isApprover,
  };
}

/** Everything the booking flow needs to know about a facility's approval gate. */
export async function approvalContext(
  facilityId: string,
  userId: string,
  role: string
): Promise<ApprovalContext> {
  const [facility, access] = await Promise.all([
    prisma.facility.findUnique({
      where: { id: facilityId },
      select: { requiresApproval: true },
    }),
    facilityAccess(facilityId, userId, role),
  ]);
  const requiresApproval = Boolean(facility?.requiresApproval);
  // A facility that requires an approval holds everybody else's slot as a
  // REQUEST until one of its approval people decides on it. An app ADMIN and
  // the facility's approval people are the deciders themselves, so they book
  // directly: their own slot — and the slot they block for SOMEBODY ELSE — is
  // confirmed the moment they submit it and never waits. The booking page
  // spells that difference out, so the amber "approval required" note can
  // never sit next to a Confirm button without explaining itself.
  return {
    requiresApproval,
    isApprover: access.isApprover,
    isPoc: access.isPoc,
    isAdmin: access.isAdmin,
    canDecide: access.manages,
    needsApproval: requiresApproval && !access.booksDirectly,
  };
}

export type ApproverContact = {
  id: string;
  name: string;
  username: string;
  email: string | null;
};

/**
 * Everyone who may decide on this facility (approval people + facility POCs +
 * the building's POCs), de-duplicated. Used to address the "approval needed"
 * mail so a request never lands nowhere.
 */
export async function approverContacts(facilityId: string): Promise<ApproverContact[]> {
  const facility = await prisma.facility.findUnique({
    where: { id: facilityId },
    select: { buildingId: true },
  });
  if (!facility) return [];

  const user = { select: { id: true, name: true, username: true, email: true } };
  const [approvers, facilityPocs, buildingPocs] = await Promise.all([
    prisma.facilityApprover.findMany({ where: { facilityId }, select: { user } }),
    prisma.facilityPoc.findMany({ where: { facilityId }, select: { user } }),
    prisma.buildingPoc.findMany({ where: { buildingId: facility.buildingId }, select: { user } }),
  ]);

  const seen = new Map<string, ApproverContact>();
  for (const row of [...approvers, ...facilityPocs, ...buildingPocs]) {
    const u = row.user;
    if (u && !seen.has(u.id)) seen.set(u.id, u);
  }
  return [...seen.values()];
}

/**
 * The facilities whose approval queue this user may open: all of them for an
 * app ADMIN, otherwise the facilities they approve for (as an approval person,
 * a facility POC, or a POC of the facility's building).
 */
export async function decidableFacilityIds(userId: string, role: string): Promise<"all" | string[]> {
  if (role === "ADMIN") return "all";

  const [approverRows, facilityPocRows, buildingPocRows] = await Promise.all([
    prisma.facilityApprover.findMany({ where: { userId }, select: { facilityId: true } }),
    prisma.facilityPoc.findMany({ where: { userId }, select: { facilityId: true } }),
    prisma.buildingPoc.findMany({ where: { userId }, select: { buildingId: true } }),
  ]);

  const ids = new Set<string>(approverRows.map((r) => r.facilityId));
  for (const r of facilityPocRows) ids.add(r.facilityId);

  const buildingIds = buildingPocRows.map((r) => r.buildingId);
  if (buildingIds.length > 0) {
    const facilities = await prisma.facility.findMany({
      where: { buildingId: { in: buildingIds } },
      select: { id: true },
    });
    for (const f of facilities) ids.add(f.id);
  }
  return [...ids];
}

export type PendingApproval = {
  id: string;
  code: string;
  /** Submission group — all slots raised in one request share it. */
  batchId: string | null;
  facilityId: string;
  facilityName: string;
  buildingName: string;
  date: string;
  endDate: string;
  startMin: number;
  endMin: number;
  status: string;
  type: string;
  purpose: string | null;
  needAvSupport: boolean;
  bookerId: string;
  bookerName: string;
  bookerUsername: string;
  forName: string | null;
  forUsername: string | null;
  requestedAt: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
};

function toPending(row: {
  id: string;
  code: string | null;
  batchId: string | null;
  facilityId: string;
  date: string;
  endDate: string;
  startMin: number;
  endMin: number;
  status: string;
  type: string;
  purpose: string | null;
  needAvSupport: boolean;
  approvalRequestedAt: Date | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  facility: { name: string; building: { name: string } };
  user: { id: string; name: string; username: string } | null;
  forUser: { name: string; username: string } | null;
  decidedBy: { name: string } | null;
}): PendingApproval {
  return {
    id: row.id,
    code: bookingCodeOf(row),
    batchId: row.batchId,
    facilityId: row.facilityId,
    facilityName: row.facility.name,
    buildingName: row.facility.building.name,
    date: row.date,
    endDate: row.endDate || row.date,
    startMin: row.startMin,
    endMin: row.endMin,
    status: row.status,
    type: row.type,
    purpose: row.purpose,
    needAvSupport: row.needAvSupport,
    bookerId: row.user?.id ?? "",
    bookerName: row.user?.name ?? "Unknown",
    bookerUsername: row.user?.username ?? "",
    forName: row.forUser?.name ?? null,
    forUsername: row.forUser?.username ?? null,
    requestedAt: row.approvalRequestedAt ? row.approvalRequestedAt.toISOString() : null,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    decidedBy: row.decidedBy?.name ?? null,
    decisionNote: row.decisionNote,
  };
}

const APPROVAL_SELECT = {
  id: true,
  code: true,
  batchId: true,
  facilityId: true,
  date: true,
  endDate: true,
  startMin: true,
  endMin: true,
  status: true,
  type: true,
  purpose: true,
  needAvSupport: true,
  approvalRequestedAt: true,
  decidedAt: true,
  decisionNote: true,
  facility: { select: { name: true, building: { select: { name: true } } } },
  user: { select: { id: true, name: true, username: true } },
  forUser: { select: { name: true, username: true } },
  decidedBy: { select: { name: true } },
} as const;

/** Bookings still waiting for a decision, oldest slot first. */
export async function listPendingApprovals(
  scope: "all" | string[],
  opts: { facilityId?: string; limit?: number } = {}
): Promise<PendingApproval[]> {
  if (scope !== "all" && scope.length === 0) return [];
  const where: Record<string, unknown> = { status: "PENDING_APPROVAL" };
  if (scope !== "all") where.facilityId = { in: scope };
  if (opts.facilityId) where.facilityId = opts.facilityId;

  const rows = await prisma.booking.findMany({
    where,
    select: APPROVAL_SELECT,
    orderBy: [{ date: "asc" }, { startMin: "asc" }],
    take: opts.limit ?? 500,
  });
  return rows.map(toPending);
}

/** Recently decided requests (approved / declined), newest decision first. */
export async function listRecentDecisions(
  scope: "all" | string[],
  limit = 25
): Promise<PendingApproval[]> {
  if (scope !== "all" && scope.length === 0) return [];
  const where: Record<string, unknown> = {
    status: { in: ["CONFIRMED", "REJECTED"] },
    decidedAt: { not: null },
  };
  if (scope !== "all") where.facilityId = { in: scope };

  const rows = await prisma.booking.findMany({
    where,
    select: APPROVAL_SELECT,
    orderBy: { decidedAt: "desc" },
    take: limit,
  });
  return rows.map(toPending);
}

/** How many requests are waiting for this user's decision (sidebar badge). */
export async function pendingApprovalCount(userId: string, role: string): Promise<number> {
  const scope = await decidableFacilityIds(userId, role);
  if (scope !== "all" && scope.length === 0) return 0;
  return prisma.booking.count({
    where: {
      status: "PENDING_APPROVAL",
      ...(scope === "all" ? {} : { facilityId: { in: scope } }),
    },
  });
}

export type DecideResult =
  | { ok: true; decision: "approve" | "decline"; bookings: PendingApproval[] }
  | { ok: false; status: number; error: string };

/**
 * Approve or decline one request — every slot it was raised for at once.
 *
 * A request is one submission, so its slots are decided together: a
 * multi-slot request (say three separate ranges) is approved or declined as a
 * whole, never half-decided. All the ids must be slots of the same facility and
 * all must still be waiting.
 *
 * Approving flips the slots to CONFIRMED (the requester and the facility's
 * notifiers are told afterwards, by the caller); declining flips them to
 * REJECTED and releases the slots. Both record who decided and the optional
 * note, and append the decision to each slot's audit history.
 *
 * The slots have been held all along (a pending request blocks overlapping
 * bookings), so approving needs no extra conflict check — but the database
 * trigger is still the backstop and a violation is reported as a conflict.
 */
export async function decideBooking(opts: {
  bookingIds: string[];
  decision: "approve" | "decline";
  note?: string | null;
  actor: { id: string; name: string; username: string; role: string };
}): Promise<DecideResult> {
  const { decision, actor } = opts;
  const ids = [...new Set(opts.bookingIds.map((id) => String(id ?? "").trim()).filter(Boolean))];
  const note = (opts.note ?? "").trim().slice(0, 500) || null;
  if (ids.length === 0) {
    return { ok: false, status: 400, error: "bookingIds is required" };
  }
  if (ids.length > 200) {
    return { ok: false, status: 400, error: "Too many slots in one decision" };
  }

  const rows = await prisma.booking.findMany({
    where: { id: { in: ids } },
    select: { id: true, facilityId: true, status: true },
  });
  if (rows.length !== ids.length) {
    return { ok: false, status: 404, error: "Booking not found" };
  }

  const facilityIds = [...new Set(rows.map((r) => r.facilityId))];
  if (facilityIds.length > 1) {
    return {
      ok: false,
      status: 400,
      error: "All slots of one decision must belong to the same facility",
    };
  }
  const facilityId = facilityIds[0];

  if (rows.some((r) => r.status !== "PENDING_APPROVAL")) {
    const approved = rows.some((r) => r.status === "CONFIRMED");
    const declined = rows.some((r) => r.status === "REJECTED");
    return {
      ok: false,
      status: 409,
      error:
        approved && !declined
          ? "This request has already been approved"
          : declined && !approved
            ? "This request has already been declined"
            : "This request is no longer waiting for an approval",
    };
  }

  const ctx = await approvalContext(facilityId, actor.id, actor.role);
  if (!ctx.canDecide) {
    return { ok: false, status: 403, error: "You are not an approval person for this facility" };
  }

  const pendingIds = rows.map((r) => r.id);

  const status = decision === "approve" ? "CONFIRMED" : "REJECTED";
  class AlreadyDecided extends Error {}
  try {
    await prisma.$transaction(async (tx) => {
      // Same facility-row lock the create/edit paths take: two approval people
      // deciding at the same time (or a decision racing a new booking) serialise
      // here, so the status re-check below cannot be out of date.
      await tx.$queryRaw`SELECT id FROM "Facility" WHERE id = ${facilityId} FOR UPDATE`;
      const stillWaiting = await tx.booking.findMany({
        where: { id: { in: pendingIds } },
        select: { status: true },
      });
      if (stillWaiting.some((r) => r.status !== "PENDING_APPROVAL")) {
        // Another approver decided first — fail loudly instead of pretending
        // this decision went through.
        throw new AlreadyDecided();
      }
      const flipped = await tx.booking.updateMany({
        where: { id: { in: pendingIds }, status: "PENDING_APPROVAL" },
        data: { status, decidedAt: new Date(), decidedById: actor.id, decisionNote: note },
      });
      if (flipped.count !== pendingIds.length) {
        throw new AlreadyDecided();
      }
      for (const id of pendingIds) {
        await tx.bookingEvent.create({
          data: {
            bookingId: id,
            kind: decision === "approve" ? "APPROVED" : "REJECTED",
            actorId: actor.id,
            actorName: actor.name,
            actorUsername: actor.username,
            reason: note,
          },
        });
      }
    });
  } catch (e) {
    if (e instanceof AlreadyDecided) {
      return {
        ok: false,
        status: 409,
        error: "This request has already been decided by someone else",
      };
    }
    const message = String((e as { message?: unknown })?.message ?? "");
    if ((e as { code?: unknown })?.code === "23P01" || /no_overlap|exclusion/i.test(message)) {
      return {
        ok: false,
        status: 409,
        error:
          "That slot was taken by another booking while this request was waiting — it cannot be confirmed",
      };
    }
    throw e;
  }

  const decided = await prisma.booking.findMany({
    where: { id: { in: pendingIds } },
    select: APPROVAL_SELECT,
    orderBy: [{ date: "asc" }, { startMin: "asc" }],
  });
  if (decided.length === 0) return { ok: false, status: 404, error: "Booking not found" };
  return { ok: true, decision, bookings: decided.map(toPending) };
}
