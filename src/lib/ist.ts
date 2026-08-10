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

/** Duration of a slot in minutes. */
export function slotDuration(startMin: number, endMin: number): number {
  return endMin - startMin;
}

// Slot policy (minutes).
export const SLOT_MIN_MINUTES = 15;
export const SLOT_MAX_MINUTES = 180; // 3 hours — self-service / on-behalf ceiling
export const PDF_MAX_BYTES = 1024 * 1024; // 1 MB
