// Shared helpers for logistics requests (vehicle + parking).
// Slot convention is identical to Booking: date = START day, endDate = END
// day ("" = same day), startMin/endMin = minutes from midnight IST.

import type { AppUser } from "@/generated/prisma/client";

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const REQ_MAX_DAYS = 14; // a single request may span at most 14 days

export function parseDate(value: unknown): string | null {
  if (typeof value !== "string" || !DATE_RE.test(value)) return null;
  return value;
}

export function parseMinutes(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const m = Math.round(value);
  if (m < 0 || m > 1440) return null;
  return m;
}

export function parsePositiveInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const n = Math.round(value);
  if (n < 1) return null;
  return n;
}

export type ParsedSlot = {
  date: string;
  endDate: string;
  startMin: number;
  endMin: number;
};

/**
 * Validate an IST slot from a request body. Returns { error } with a message
 * or { slot } when valid. Requires endMin > startMin and a span of at least
 * 15 minutes, no more than REQ_MAX_DAYS.
 */
export function parseSlot(body: Record<string, unknown>): { slot?: ParsedSlot; error?: string } {
  const date = parseDate(body.date);
  if (!date) return { error: "A valid start date (YYYY-MM-DD) is required" };
  let endDate = typeof body.endDate === "string" && body.endDate ? body.endDate : "";
  if (!endDate) endDate = date;
  if (!DATE_RE.test(endDate) || endDate < date) endDate = date;

  const startMin = parseMinutes(body.startMin);
  const endMin = parseMinutes(body.endMin);
  if (startMin === null || endMin === null) return { error: "Start and end times are required (minutes from midnight IST)" };
  if (endMin <= startMin) return { error: "End time must be after start time" };

  const startIdx = Math.floor(Date.parse(`${date}T00:00:00Z`) / 60000) + startMin;
  const endIdx = Math.floor(Date.parse(`${endDate}T00:00:00Z`) / 60000) + endMin;
  const duration = endIdx - startIdx;
  if (duration < 15) return { error: "Minimum request duration is 15 minutes" };
  if (duration > REQ_MAX_DAYS * 24 * 60) {
    return { error: `A single request may span at most ${REQ_MAX_DAYS} days` };
  }

  return { slot: { date, endDate, startMin, endMin } };
}

/**
 * Who may decide (approve / reject / complete) logistics requests:
 * the app admin and any user flagged as a POC (logistics POC).
 */
export function canDecide(user: AppUser | null): boolean {
  return !!user && (user.role === "ADMIN" || user.isPoc);
}
