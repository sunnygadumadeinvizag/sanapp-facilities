import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Booking life-cycle notifications + audit events.
 *
 * Two concerns live here:
 *
 * 1. BookingEvent — the permanent audit trail (created / edited / cancelled).
 *    Written on every life-cycle change; powers the admin booking-history view
 *    and the booker's own edit history in My Bookings.
 *
 * 2. Booking notification email — per facility the app admin configures who is
 *    told about a booking (FacilityNotifyConfig): a list of notifier addresses,
 *    plus optionally the person who MADE the booking and the person it was
 *    blocked FOR. Recipients get ONE mail per booking STATE (keyed by booking
 *    code): when another slot joins the same booking, the same notification is
 *    UPDATED and re-sent with the full slot list — never one mail per slot.
 *
 *    The body is plain text only — no HTML, no colours and no space-padded
 *    columns, because mail clients render text/plain with a proportional font
 *    and padded "label : value" alignment comes out ragged.
 *
 * Email goes through the SSO's key-guarded internal relay
 * (/sso/api/admin/mail) because SMTP credentials live in sanapp_sso_db.
 */

const SSO_BASE_URL = process.env.SSO_BASE_URL ?? "";
const SSO_ADMIN_KEY = process.env.SSO_ADMIN_KEY ?? "";

export const EVENT_KINDS = ["CREATED", "EDITED", "CANCELLED"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export type ChangeEntry = { field: string; before: string; after: string };

/* -------------------------------------------------------------------------- */
/* Booking codes                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The next human-readable booking reference, e.g. "FACLTY-BKG-R1".
 *
 * The number comes from the `booking_code_seq` Postgres sequence instead of a
 * MAX()/count query, so two bookings created at the same instant can never be
 * handed the same reference. Called inside the transaction that inserts the
 * slot, so a rolled-back booking also releases its number.
 */
export async function nextBookingCode(tx: Prisma.TransactionClient): Promise<string> {
  const [row] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('booking_code_seq') AS n`;
  if (!row) throw new Error("booking_code_seq returned no value");
  return `FACLTY-BKG-R${row.n}`;
}

/** The booking's display code: the shared batch code, or the slot id fallback. */
export function bookingCodeOf(b: { code: string | null; batchId: string | null; id: string }): string {
  return b.code ?? b.batchId ?? b.id;
}

/** Resolve the canonical code of a booking (lives on the first slot of its batch). */
export async function resolveBookingCode(b: { code: string | null; batchId: string | null; id: string }): Promise<string> {
  if (b.code) return b.code;
  if (b.batchId) {
    const anchor = await prisma.booking.findFirst({
      where: { batchId: b.batchId, code: { not: null } },
      select: { code: true },
      orderBy: { createdAt: "asc" },
    });
    if (anchor?.code) return anchor.code;
  }
  return b.id;
}

/* -------------------------------------------------------------------------- */
/* Audit events                                                               */
/* -------------------------------------------------------------------------- */

export function recordEvent(
  tx: { bookingEvent: { create: (args: {
    data: {
      bookingId: string;
      kind: string;
      actorId?: string | null;
      actorName?: string | null;
      actorUsername?: string | null;
      changes?: string | null;
      reason?: string | null;
    };
  }) => unknown } },
  input: {
    bookingId: string;
    kind: EventKind;
    actorId?: string | null;
    actorName?: string | null;
    actorUsername?: string | null;
    changes?: ChangeEntry[];
    reason?: string | null;
  }
) {
  return tx.bookingEvent.create({
    data: {
      bookingId: input.bookingId,
      kind: input.kind,
      actorId: input.actorId ?? null,
      actorName: input.actorName ?? null,
      actorUsername: input.actorUsername ?? null,
      changes: input.changes ? JSON.stringify(input.changes) : null,
      reason: input.reason ?? null,
    },
  });
}

/** History of one booking, oldest first (admin or the booking's owner). */
export async function bookingHistory(bookingId: string) {
  return prisma.bookingEvent.findMany({
    where: { bookingId },
    orderBy: { at: "asc" },
    select: {
      id: true,
      kind: true,
      at: true,
      actorId: true,
      actorName: true,
      actorUsername: true,
      changes: true,
      reason: true,
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Notifier digest email                                                      */
/* -------------------------------------------------------------------------- */

export type NotifyBooking = {
  code: string | null;
  batchId: string | null;
  id: string;
  facilityId: string;
  needAvSupport: boolean;
  purpose: string | null;
  status: string;
  facility: { name: string; building: { name: string } | null };
  user: { name: string; username: string } | null;
  forUser: { name: string; username: string } | null;
};

export type NotifySlot = {
  bookingId: string;
  date: string;
  endDate: string;
  startMin: number;
  endMin: number;
  status: string;
};

function fmtMin(m: number): string {
  return `${Math.floor(m / 60).toString().padStart(2, "0")}:${(m % 60).toString().padStart(2, "0")}`;
}

/** A slot's time range: always IST, always the 24-hour clock. */
function fmtSlot(s: NotifySlot): string {
  if (s.endDate && s.endDate !== s.date) {
    return `${s.date} ${fmtMin(s.startMin)} → ${s.endDate} ${fmtMin(s.endMin)} IST`;
  }
  return `${s.date} ${fmtMin(s.startMin)}–${fmtMin(s.endMin)} IST`;
}

function fmtDuration(date: string, endDate: string, startMin: number, endMin: number): string {
  const dayMs = 24 * 60;
  const day = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 60000);
  const total = day(endDate || date) + endMin - (day(date) + startMin);
  if (total <= 0) return "0m";
  const days = Math.floor(total / dayMs);
  const rem = total % dayMs;
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (Math.floor(rem / 60)) parts.push(`${Math.floor(rem / 60)}h`);
  if (rem % 60) parts.push(`${rem % 60}m`);
  return parts.join(" ") || "0m";
}

/** True when any notifiers are configured for this facility at all. */
export async function facilityHasNotifiers(facilityId: string): Promise<boolean> {
  const cfg = await prisma.facilityNotifyConfig.findUnique({ where: { facilityId } });
  return Boolean(cfg && cfg.notifyEmails.length > 0 && (cfg.notifyOnSlotBooked || cfg.notifyOnAvChange));
}

/**
 * The trigger decision: given what changed, does this facility's configuration
 * want a notification for it?
 *   - AV support toggled on/off (added / removed / edited) → notifyOnAvChange
 *   - any other booking change (new slot, moved slot, cancel…) → notifyOnSlotBooked
 */
export function shouldNotify(
  cfg: { notifyOnSlotBooked: boolean; notifyOnAvChange: boolean; notifyEmails: string[] },
  avChanged: boolean
): boolean {
  if (cfg.notifyEmails.length === 0) return false;
  if (avChanged) return cfg.notifyOnAvChange || cfg.notifyOnSlotBooked;
  return cfg.notifyOnSlotBooked;
}

/* -------------------------------------------------------------------------- */
/* Mail content                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Plain-text signature. Text only on purpose: the relay posts this as a
 * text/plain body, so nothing here may rely on HTML, colour or alignment.
 */
const SIGNATURE = [
  "--",
  "IIPE Intranet | Facilities Booking",
  "Indian Institute of Petroleum and Energy",
  "Automated message — please do not reply.",
].join("\n");

/**
 * The notification body, as plain text.
 *
 * Each label sits on its own line with its value and is NOT space-padded into
 * aligned columns: a text/plain body is rendered with a proportional font, so
 * padded labels line up differently in every mail client. Every line starts at
 * the same left margin instead, which is the alignment that actually survives.
 *
 * The booking reference is repeated after the signature so it is still visible
 * when a client hides the quoted/forwarded part of a thread.
 */
export function buildBookingBody(opts: {
  code: string;
  booking: NotifyBooking;
  rows: NotifySlot[];
}): string {
  const { code, booking, rows } = opts;
  const facility = booking.facility.building?.name
    ? `${booking.facility.building.name} — ${booking.facility.name}`
    : booking.facility.name;

  const lines = [
    `Booking ID: ${code}`,
    `Facility: ${facility}`,
    `Booked by: ${booking.user?.name ? `${booking.user.name} (@${booking.user.username})` : "—"}`,
  ];
  // Only meaningful for on-behalf bookings, so it is left out otherwise.
  if (booking.forUser) {
    lines.push(`Booked on behalf of: ${booking.forUser.name} (@${booking.forUser.username})`);
  }
  lines.push(
    `Description: ${booking.purpose?.trim() || "—"}`,
    `AV support: ${booking.needAvSupport ? "Yes — AV technician needed" : "No"}`,
    `Status: ${booking.status}`,
    "",
    `Slots (${rows.length}):`,
    ...rows.map(
      (s, i) =>
        `${i + 1}. ${fmtSlot(s)} (${fmtDuration(s.date, s.endDate, s.startMin, s.endMin)})${
          s.status === "CANCELLED" ? "  [CANCELLED]" : ""
        }`
    ),
    "",
    "All times are Indian Standard Time (IST) and use the 24-hour clock.",
    "",
    SIGNATURE,
    "",
    `Booking ID: ${code}`,
  );
  return lines.join("\n");
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

/** Who receives this mail, and under which subject. */
async function buildRecipients(opts: {
  cfg: { notifyEmails: string[] };
  booking: NotifyBooking;
  wantsNotifiers: boolean;
  wantsBooker: boolean;
  wantsForUser: boolean;
  code: string;
  rows: NotifySlot[];
}): Promise<{ to: string[]; subject: string }[]> {
  const { cfg, booking, code, rows } = opts;
  const facility = booking.facility.name;
  const slotsWord = `${rows.length} slot${rows.length === 1 ? "" : "s"}`;
  const stateWord = booking.status === "CANCELLED" ? "cancelled" : "confirmed";
  const groups: { to: string[]; subject: string }[] = [];

  if (opts.wantsNotifiers && cfg.notifyEmails.length > 0) {
    groups.push({
      to: cfg.notifyEmails,
      subject: `Facilities booking ${code} — ${facility} (${slotsWord})`,
    });
  }

  if (opts.wantsBooker) {
    const to = await emailOf(booking.user?.username);
    if (to) {
      groups.push({
        to: [to],
        subject: `Your facilities booking ${code} — ${facility} — ${stateWord}`,
      });
    } else if (booking.user) {
      console.warn(`booking notify: no email on record for @${booking.user.username}`);
    }
  }

  if (opts.wantsForUser) {
    const to = await emailOf(booking.forUser?.username);
    if (to) {
      groups.push({
        to: [to],
        subject: `Facilities booking ${code} made for you — ${facility} — ${stateWord}`,
      });
    } else if (booking.forUser) {
      console.warn(`booking notify: no email on record for @${booking.forUser.username}`);
    }
  }

  return groups;
}

/**
 * Send (or refresh) a booking's notification mail to everyone this facility is
 * configured to tell:
 *   - the notifier address list        (notifyOnSlotBooked / notifyOnAvChange)
 *   - the person who made the booking  (notifyBookingUser)
 *   - the person it was blocked for    (notifyForUser, on-behalf bookings only)
 *
 * Fire-and-forget from the caller's point of view: never throws, logs only.
 * Returns true when the relay accepted at least one mail.
 */
export async function sendBookingDigest(opts: {
  booking: NotifyBooking;
  avChanged?: boolean;
}): Promise<boolean> {
  const { booking } = opts;
  try {
    const cfg = await prisma.facilityNotifyConfig.findUnique({
      where: { facilityId: booking.facilityId },
    });
    if (!cfg) return false;

    const wantsNotifiers = shouldNotify(cfg, opts.avChanged === true);
    const wantsBooker = cfg.notifyBookingUser;
    const wantsForUser = cfg.notifyForUser && Boolean(booking.forUser);
    if (!wantsNotifiers && !wantsBooker && !wantsForUser) return false;

    const code = await resolveBookingCode(booking);

    // All confirmed (and, when cancelled, the cancelled) slots of this booking.
    const slots = await prisma.booking.findMany({
      where: booking.batchId
        ? { batchId: booking.batchId }
        : { id: booking.id },
      orderBy: [{ date: "asc" }, { startMin: "asc" }],
      select: { id: true, date: true, endDate: true, startMin: true, endMin: true, status: true },
    });
    const rows: NotifySlot[] = slots.length > 0
      ? slots.map((s) => ({ bookingId: s.id, date: s.date, endDate: s.endDate || s.date, startMin: s.startMin, endMin: s.endMin, status: s.status }))
      : [{ bookingId: booking.id, date: "", endDate: "", startMin: 0, endMin: 0, status: booking.status }];

    const body = buildBookingBody({ code, booking, rows });

    // One mail per booking STATE, keyed by the booking (code) rather than the
    // slot: an unchanged booking is never mailed twice.
    const prev = await prisma.bookingNotifyState.findFirst({
      where: { code: code },
      orderBy: { createdAt: "asc" },
    });
    if (prev?.lastBody === body) return false;

    const groups = await buildRecipients({
      cfg,
      booking,
      wantsNotifiers,
      wantsBooker,
      wantsForUser,
      code,
      rows,
    });
    if (groups.length === 0) return false;

    let sent = false;
    if (SSO_BASE_URL && SSO_ADMIN_KEY) {
      for (const group of groups) {
        try {
          const res = await fetch(`${SSO_BASE_URL}/api/admin/mail`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-admin-key": SSO_ADMIN_KEY },
            body: JSON.stringify({ to: group.to, subject: group.subject, text: body }),
            cache: "no-store",
            signal: AbortSignal.timeout(15000),
          });
          if (res.ok) sent = true;
          else console.error("booking notify mail failed:", res.status, await res.text().catch(() => ""));
        } catch (e) {
          console.error("booking notify mail error:", e);
        }
      }
    } else {
      console.warn(`booking notify: SSO mail relay not configured — mail for ${code} not sent`);
    }

    // Record the body only when something actually went out, so a relay outage
    // is retried on the next change instead of silencing the booking forever.
    if (prev) {
      await prisma.bookingNotifyState.update({
        where: { id: prev.id },
        data: { lastBody: sent ? body : prev.lastBody ?? null },
      });
    } else {
      await prisma.bookingNotifyState.upsert({
        where: { bookingId: booking.id },
        update: { code, lastBody: sent ? body : null },
        create: { bookingId: booking.id, code, lastBody: sent ? body : null },
      });
    }
    return sent;
  } catch (e) {
    console.error("sendBookingDigest failed:", e);
    return false;
  }
}
