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
 * 2. Notifier email digest — per facility the app admin configures notifiers
 *    (FacilityNotifyConfig) and what to notify about (slot booked / AV change).
 *    Notifiers get ONE digest email per booking (keyed by booking code): when
 *    another slot joins the same booking, the same notification is UPDATED and
 *    re-sent with the full slot list — never one mail per slot.
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

function fmtSlot(s: NotifySlot): string {
  if (s.endDate && s.endDate !== s.date) {
    return `${s.date} ${fmtMin(s.startMin)} → ${s.endDate} ${fmtMin(s.endMin)}`;
  }
  return `${s.date} ${fmtMin(s.startMin)}–${fmtMin(s.endMin)}`;
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

/**
 * Send (or refresh) the per-booking digest mail to a facility's notifiers.
 * Fire-and-forget from the caller's point of view: never throws, logs only.
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
    if (!cfg || !shouldNotify(cfg, opts.avChanged === true)) return false;

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

    const booker = booking.user?.name ? `${booking.user.name} (@${booking.user.username})` : "—";
    const forLine = booking.forUser
      ? `\nBlocked for : ${booking.forUser.name} (@${booking.forUser.username})`
      : "";
    const avLine = booking.needAvSupport ? "YES — AV technician needed" : "No";

    const slotLines = rows
      .map(
        (s) =>
          `  • ${fmtSlot(s)} (${fmtDuration(s.date, s.endDate, s.startMin, s.endMin)})${
            s.status === "CANCELLED" ? "  [CANCELLED]" : ""
          }`
      )
      .join("\n");

    const body = [
      `Booking ID   : ${code}`,
      `Facility     : ${booking.facility.building?.name ? booking.facility.building.name + " — " : ""}${booking.facility.name}`,
      `Booked by    : ${booker}${forLine}`,
      `Description  : ${booking.purpose?.trim() || "—"}`,
      `AV support   : ${avLine}`,
      `Status       : ${booking.status}`,
      ``,
      `Slots (${rows.length}):`,
      slotLines,
      ``,
      `— IIPE Facilities Booking`,
    ].join("\n");

    // Digest: keyed by the BOOKING (code), not the slot — one mail per booking.
    const prev = await prisma.bookingNotifyState.findFirst({
      where: { code: code },
      orderBy: { createdAt: "asc" },
    });
    if (prev?.lastBody === body) return false;

    const subject = `Facilities booking ${code} — ${booking.facility.name} (${rows.length} slot${rows.length === 1 ? "" : "s"})`;

    let sent = false;
    if (SSO_BASE_URL && SSO_ADMIN_KEY) {
      try {
        const res = await fetch(`${SSO_BASE_URL}/api/admin/mail`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-admin-key": SSO_ADMIN_KEY },
          body: JSON.stringify({ to: cfg.notifyEmails, subject, text: body }),
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
        });
        sent = res.ok;
        if (!res.ok) console.error("booking notify mail failed:", res.status, await res.text().catch(() => ""));
      } catch (e) {
        console.error("booking notify mail error:", e);
      }
    } else {
      console.warn(`booking notify: SSO mail relay not configured — digest for ${code} not sent`);
    }

    if (prev) {
      await prisma.bookingNotifyState.update({
        where: { id: prev.id },
        data: { lastBody: sent ? body : prev.lastBody ?? body },
      });
    } else {
      await prisma.bookingNotifyState.upsert({
        where: { bookingId: booking.id },
        update: { code, lastBody: body },
        create: { bookingId: booking.id, code, lastBody: body },
      });
    }
    return sent;
  } catch (e) {
    console.error("sendBookingDigest failed:", e);
    return false;
  }
}
