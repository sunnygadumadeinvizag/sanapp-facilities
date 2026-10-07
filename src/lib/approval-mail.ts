import { prisma } from "@/lib/prisma";
import { approverContacts } from "@/lib/approval";
import {
  buildBookingBody,
  relayMail,
  resolveBookingCode,
  type NotifyBooking,
  type NotifySlot,
} from "@/lib/notify";

/**
 * The approval-workflow mails.
 *
 * These are the two moments that must never be missed on a facility with
 * `requiresApproval`:
 *
 *   1. someone requests a slot  → every approval person of the facility is
 *      told, so the request is never left sitting unnoticed;
 *   2. the request is decided   → the person who asked is told whether the
 *      slot is theirs or was declined, with the decision note.
 *
 * Both are deliberately independent of the per-facility notifier configuration
 * (FacilityNotifyConfig): that configuration decides who hears about ordinary
 * bookings, while an approval request has exactly one meaningful audience —
 * the people who can decide it — and the requester must always hear the
 * outcome. Mails are plain text through the SSO relay, like every other mail in
 * this app.
 */

export type ApprovalMailKind = "request" | "approved" | "declined";

/** The lines that sit above the standard booking summary. */
function notice(kind: ApprovalMailKind, note?: string | null, decidedBy?: string | null): string[] {
  if (kind === "request") {
    return [
      "APPROVAL REQUESTED",
      "",
      "A slot on a facility you approve for has been requested. It is NOT",
      "confirmed yet — it is being held while you decide, and the person who",
      "asked has not been given the slot.",
      "",
      "Open Facilities → Approvals to approve or decline it.",
      "",
    ];
  }
  const approved = kind === "approved";
  const lines = [
    approved ? "APPROVAL GRANTED" : "REQUEST DECLINED",
    "",
    approved
      ? "The slot you requested has been approved and is now confirmed. It is yours."
      : "The slot you requested was declined. It has been released and is no longer held for you.",
    "",
  ];
  if (decidedBy) lines.push(`Decided by: ${decidedBy}`);
  lines.push(`Decision note: ${note?.trim() || "—"}`, "");
  return lines;
}

/** Every slot of the request, newest state, oldest slot first. */
async function requestSlots(booking: NotifyBooking): Promise<NotifySlot[]> {
  const slots = await prisma.booking.findMany({
    where: booking.batchId ? { batchId: booking.batchId } : { id: booking.id },
    orderBy: [{ date: "asc" }, { startMin: "asc" }],
    select: { id: true, date: true, endDate: true, startMin: true, endMin: true, status: true },
  });
  if (slots.length === 0) {
    return [
      {
        bookingId: booking.id,
        date: "",
        endDate: "",
        startMin: 0,
        endMin: 0,
        status: booking.status,
      },
    ];
  }
  return slots.map((s) => ({
    bookingId: s.id,
    date: s.date,
    endDate: s.endDate || s.date,
    startMin: s.startMin,
    endMin: s.endMin,
    status: s.status,
  }));
}

/**
 * Send one approval mail.
 *
 * `request` goes to every approval person of the facility (its configured
 * approval people, its POCs and its building's POCs — anyone who may decide),
 * `approved` / `declined` go to the person who made the request.
 *
 * Never throws: approval of a booking must not depend on the mail relay.
 */
export async function sendApprovalMail(opts: {
  booking: NotifyBooking;
  kind: ApprovalMailKind;
  note?: string | null;
  decidedBy?: string | null;
}): Promise<boolean> {
  const { booking, kind } = opts;
  try {
    const code = await resolveBookingCode(booking);
    const rows = await requestSlots(booking);
    const facility = booking.facility.name;
    const slotsWord = `${rows.length} slot${rows.length === 1 ? "" : "s"}`;
    const body = [
      ...notice(kind, opts.note, opts.decidedBy),
      buildBookingBody({ code, booking, rows }),
    ].join("\n");

    const groups: { to: string[]; subject: string }[] = [];

    if (kind === "request") {
      const contacts = await approverContacts(booking.facilityId);
      const to = [
        ...new Set(
          contacts
            .map((c) => c.email?.trim())
            .filter((e): e is string => Boolean(e))
        ),
      ];
      if (to.length > 0) {
        groups.push({
          to,
          subject: `Approval requested — facilities booking ${code} — ${facility} (${slotsWord})`,
        });
      } else {
        console.warn(
          `approval notify: no approval person with an email address on facility ${booking.facilityId}`
        );
      }
    } else {
      const to: string[] = [];
      const booker = await emailOf(booking.user?.username);
      if (booker) to.push(booker);
      const forUser = await emailOf(booking.forUser?.username);
      if (forUser) to.push(forUser);
      if (to.length > 0) {
        groups.push({
          to: [...new Set(to)],
          subject:
            kind === "approved"
              ? `Your facilities booking ${code} — ${facility} — approved`
              : `Your facilities booking ${code} — ${facility} — declined`,
        });
      } else if (booking.user) {
        console.warn(`approval notify: no email on record for @${booking.user.username}`);
      }
    }

    if (groups.length === 0) return false;
    return await relayMail(groups, body, code);
  } catch (e) {
    console.error("sendApprovalMail failed:", e);
    return false;
  }
}

/** A person's notification address, from the SSO-synced local user record. */
async function emailOf(username: string | null | undefined): Promise<string | null> {
  const value = username?.trim();
  if (!value) return null;
  const u = await prisma.appUser.findUnique({
    where: { username: value },
    select: { email: true },
  });
  return u?.email?.trim() || null;
}

/* -------------------------------------------------------------------------- */
/* Coalescing                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The facility's "notify the approver when a slot request is initiated" switch.
 * A facility with no configuration row at all keeps the default (notify), so an
 * approval request is never silently dropped.
 */
async function notifiesApprovers(facilityId: string): Promise<boolean> {
  try {
    const cfg = await prisma.facilityNotifyConfig.findUnique({
      where: { facilityId },
      select: { notifyApproverOnRequest: true },
    });
    return cfg ? cfg.notifyApproverOnRequest : true;
  } catch (e) {
    console.error("approval notify: could not read the facility's notify config:", e);
    return true;
  }
}

/**
 * One approval mail per request, not per slot.
 *
 * A multi-range request is posted as one call per range, all sharing a batchId,
 * so sending straight from each call would mail the approval people once per
 * range. Instead the send is held for a moment and re-armed by every further
 * slot of the same submission; the mail that finally goes out is built from the
 * database and therefore lists the whole request.
 *
 * Worst case, if the process restarts in that window, the request is still
 * waiting in the in-app approval queue — only the mail is skipped, and the
 * approver badge still shows it.
 */
const COALESCE_MS = 3000;
const pending = new Map<string, ReturnType<typeof setTimeout>>();

export function queueApprovalRequestMail(booking: NotifyBooking): void {
  const key = booking.batchId ?? booking.id;
  const existing = pending.get(key);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    pending.delete(key);
    void (async () => {
      // The facility decides whether its approval people hear about a request
      // the moment it is made ("approver will be notified when a slot request
      // is initiated"). Absent configuration means the default: notify.
      if (!(await notifiesApprovers(booking.facilityId))) return;
      await sendApprovalMail({ booking, kind: "request" });
    })();
  }, COALESCE_MS);
  // Never hold the process open just for a notification.
  timer.unref?.();
  pending.set(key, timer);
}
