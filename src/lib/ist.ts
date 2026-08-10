// Indian Standard Time helpers.
//
// IST is UTC+5:30 with no daylight saving, so the offset is constant. All
// booking slots are expressed as a plain calendar date (YYYY-MM-DD in IST)
// plus start/end as minutes-from-midnight IST. The helpers below derive the
// current IST wall-clock time by shifting the UTC clock — no locale strings,
// no client timezones, always the server's clock.

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** A Date whose UTC fields equal the current IST wall-clock time. */
export function istNow(): Date {
  return new Date(Date.now() + IST_OFFSET_MS);
}

/** Today's date as YYYY-MM-DD in IST. */
export function istDateKey(d: Date = istNow()): string {
  return d.toISOString().slice(0, 10);
}

/** Current time as minutes-from-midnight IST (0..1439). */
export function istMinute(d: Date = istNow()): number {
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** Format minutes-from-midnight as HH:MM (24h). */
export function fmtMin(m: number): string {
  const h = Math.floor(m / 60)
    .toString()
    .padStart(2, "0");
  const min = (m % 60).toString().padStart(2, "0");
  return `${h}:${min}`;
}

/** Format a slot as "09:30 – 11:00 IST". */
export function fmtSlot(startMin: number, endMin: number): string {
  return `${fmtMin(startMin)} – ${fmtMin(endMin)} IST`;
}

/**
 * Comparable absolute minute index of a wall-clock point (IST). The date key
 * is already an IST wall date, so parsing it as UTC keeps the arithmetic
 * consistent — only relative ordering matters for overlap/duration checks.
 */
export function slotIndex(dateKey: string, minuteOfDay: number): number {
  return Math.floor(Date.parse(`${dateKey}T00:00:00Z`) / 60000) + minuteOfDay;
}

/** Duration of a slot in minutes, including multi-day spans. */
export function slotDurationMin(
  startDate: string,
  startMin: number,
  endDate: string,
  endMin: number
): number {
  return slotIndex(endDate, endMin) - slotIndex(startDate, startMin);
}

/** Effective end day of a booking ("" endDate means same-day). */
export function endDayOf(date: string, endDate: string | null | undefined): string {
  return endDate && endDate >= date ? endDate : date;
}

/** Add N days to a YYYY-MM-DD key, returning a new YYYY-MM-DD key. */
export function addDays(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Range of inclusive day keys from startDate to endDate (IST). */
export function dayRange(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  let d = startDate;
  let guard = 0;
  while (d <= endDate && guard < 400) {
    out.push(d);
    d = addDays(d, 1);
    guard += 1;
  }
  return out;
}

/** Human label for a possibly multi-day slot: "23:30 D – 01:00 D+1 IST". */
export function fmtSlotRange(
  startDate: string,
  startMin: number,
  endDate: string,
  endMin: number
): string {
  const s = `${fmtMin(startMin)} ${startDate}`;
  if (endDate === startDate) return `${fmtMin(startMin)} – ${fmtMin(endMin)} IST (${startDate})`;
  return `${s} → ${fmtMin(endMin)} ${endDate} IST`;
}

// Slot policy (minutes).
export const SLOT_MIN_MINUTES = 15;
export const SLOT_MAX_MINUTES = 180; // 3 hours — self-service / on-behalf ceiling
export const PDF_MAX_BYTES = 1024 * 1024; // 1 MB
