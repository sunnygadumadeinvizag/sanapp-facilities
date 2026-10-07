// Bookable availability of a facility.
//
// An app admin — or the facility's approval people — can:
//   * shorten the bookable day (e.g. 09:00 to 18:00 instead of the whole day);
//   * close recurring weekdays (e.g. every Sunday);
//   * close individual dates (a one-off closure);
//   * cap how long one booking may be (the facility's maxMinutes).
//
// The server is the authority: every request is checked here before the slot is
// stored. The booking calendar is drawn from the same values, so a slot the
// server would refuse cannot even be selected.
//
// Everything is expressed in IST — a plain YYYY-MM-DD date plus minutes from
// midnight, exactly like the rest of this app. There is no timezone arithmetic.

import { SLOT_MIN_MINUTES, fmtMin } from "./ist";

/**
 * One weekday's own bookable window, in minutes from midnight IST. A weekday
 * with its own window is bookable then whatever the facility window says — a lab
 * open 09:00–18:00 on weekdays but only 09:00–13:00 on Saturdays.
 */
export type DayWindow = { open: number; close: number };

export type Availability = {
  /** First bookable minute of a day (0 = midnight). */
  openMin: number;
  /** First NON-bookable minute of a day (1440 = midnight, i.e. the whole day). */
  closeMin: number;
  /** Recurring closures, 0 = Sunday … 6 = Saturday. */
  closedWeekdays: number[];
  /** One-off closures as plain YYYY-MM-DD (IST) dates. */
  closedDates: string[];
  /**
   * Per-weekday hours that override the window above, keyed by weekday number
   * as a string ("0" = Sunday … "6" = Saturday). A weekday that is closed
   * outright belongs in closedWeekdays; an absent weekday uses openMin/closeMin.
   */
  dayWindows: Record<string, DayWindow>;
};

/** The default: every day, all day, never closed. */
export const FULL_DAY: Availability = {
  openMin: 0,
  closeMin: 1440,
  closedWeekdays: [],
  closedDates: [],
  dayWindows: {},
};

export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function weekdayOf(dateKey: string): number {
  return new Date(`${dateKey}T00:00:00Z`).getUTCDay();
}

export function weekdayName(n: number): string {
  return WEEKDAY_NAMES[n] ?? `day ${n}`;
}

/** Minutes-from-midnight as HH:MM; midnight at the end of the day reads 24:00. */
export function minuteLabel(m: number): string {
  if (m >= 1440) return "24:00";
  return fmtMin(m);
}

/** "09:00 – 18:00 IST". */
export function windowLabel(av: Availability): string {
  return `${minuteLabel(av.openMin)} – ${minuteLabel(av.closeMin)} IST`;
}

/** True when the facility is bookable round the clock and never closed. */
export function isFullDay(av: Availability): boolean {
  return (
    av.openMin <= 0 &&
    av.closeMin >= 1440 &&
    av.closedWeekdays.length === 0 &&
    av.closedDates.length === 0 &&
    Object.keys(av.dayWindows ?? {}).length === 0
  );
}

/** The hours of one date: that weekday's own window, or the facility window. */
export function windowFor(av: Availability, dateKey: string): DayWindow {
  const own = (av.dayWindows ?? {})[String(weekdayOf(dateKey))];
  return own ?? { open: av.openMin, close: av.closeMin };
}

/** True when this date's weekday has hours of its own. */
export function hasOwnWindow(av: Availability, dateKey: string): boolean {
  return Boolean((av.dayWindows ?? {})[String(weekdayOf(dateKey))]);
}

/** "09:00 – 13:00 IST" for one date, own hours or the facility window. */
export function windowLabelFor(av: Availability, dateKey: string): string {
  const w = windowFor(av, dateKey);
  return `${minuteLabel(w.open)} – ${minuteLabel(w.close)} IST`;
}

/** The weekdays that have hours of their own, Sunday first. */
export function ownWindowWeekdays(av: Availability): number[] {
  return Object.keys(av.dayWindows ?? {})
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
    .sort((a, b) => a - b);
}

/**
 * The per-weekday hours as stored in the database (`Facility.dayWindows` is a
 * JSON column, so anything could be in there). Malformed entries are dropped
 * rather than thrown, so a hand-edited row can never break the calendar.
 */
export function dayWindowsFromDb(value: unknown): Record<string, DayWindow> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, DayWindow> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const day = Number(key);
    if (!Number.isInteger(day) || day < 0 || day > 6) continue;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    const open = Number(entry.open);
    const close = Number(entry.close);
    if (!Number.isInteger(open) || !Number.isInteger(close)) continue;
    if (open < 0 || close > 1440 || close - open < SLOT_MIN_MINUTES) continue;
    out[String(day)] = { open, close };
  }
  return out;
}

/**
 * A facility row as an Availability. `dayWindows` is a JSON column, so it is
 * read through dayWindowsFromDb() rather than trusted: a hand-edited row can
 * never make the calendar or the booking API throw.
 */
export function facilityAvailability(facility: {
  openMin: number;
  closeMin: number;
  closedWeekdays: number[];
  closedDates: string[];
  dayWindows?: unknown;
}): Availability {
  return {
    openMin: facility.openMin,
    closeMin: facility.closeMin,
    closedWeekdays: facility.closedWeekdays,
    closedDates: facility.closedDates,
    dayWindows: dayWindowsFromDb(facility.dayWindows),
  };
}

export function isClosedWeekday(av: Availability, weekday: number): boolean {
  return av.closedWeekdays.includes(weekday);
}

/** Why this date is not bookable at all, or null when it is open. */
export function closedReason(av: Availability, dateKey: string): string | null {
  if (av.closedDates.includes(dateKey)) {
    return `this facility is closed on ${dateKey}`;
  }
  if (isClosedWeekday(av, weekdayOf(dateKey))) {
    return `this facility is closed on ${weekdayName(weekdayOf(dateKey))}s`;
  }
  return null;
}

/** Inclusive list of YYYY-MM-DD days from start to end (guarded against typos). */
export function daysBetween(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  let d = startDate;
  let guard = 0;
  while (d <= endDate && guard < 400) {
    out.push(d);
    const next = new Date(`${d}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    d = next.toISOString().slice(0, 10);
    guard += 1;
  }
  return out;
}

/**
 * The reason a slot may not be booked on this facility, or null when it may.
 * This is the single rule the API enforces and the calendar mirrors.
 */
export function availabilityError(
  av: Availability,
  startDate: string,
  startMin: number,
  endDate: string,
  endMin: number
): string | null {
  if (isFullDay(av)) return null;

  for (const day of daysBetween(startDate, endDate)) {
    const why = closedReason(av, day);
    if (why) {
      const which = day === startDate ? "" : ` (${day})`;
      return `${why.charAt(0).toUpperCase()}${why.slice(1)}${which} — no slot can be booked then.`;
    }
  }

  // The hours of the day the slot starts on, and of the day it ends on. A
  // weekday with its own window is bound by that window, not by the facility's.
  const startWindow = windowFor(av, startDate);
  if (startMin < startWindow.open) {
    if (hasOwnWindow(av, startDate)) {
      const day = weekdayName(weekdayOf(startDate));
      return `${day}s are bookable from ${minuteLabel(startWindow.open)} IST on this facility — its ${day} hours are ${windowLabelFor(av, startDate)}.`;
    }
    return `This facility is bookable from ${minuteLabel(startWindow.open)} IST — its bookable hours are ${windowLabel(av)}.`;
  }
  const endWindow = windowFor(av, endDate);
  if (endMin > endWindow.close) {
    if (hasOwnWindow(av, endDate)) {
      const day = weekdayName(weekdayOf(endDate));
      return `A booking that ends on a ${day} must end by ${minuteLabel(endWindow.close)} IST (this facility is bookable ${windowLabelFor(av, endDate)} on ${day}s). Please pick a slot that ends by then.`;
    }
    return `This facility is bookable until ${minuteLabel(endWindow.close)} IST (its bookable hours are ${windowLabel(av)}). Please pick a slot that ends by then.`;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Reading the values out of a request body                                   */
/* -------------------------------------------------------------------------- */

/** "09:00" → 540 · 540 → 540 · "" → null. */
function toMinute(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  if (/^\d{1,4}$/.test(text)) return Number(text);
  const m = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 24 || mi > 59) return null;
  return h * 60 + mi;
}

function toDateList(value: unknown): string[] {
  const parts: string[] = Array.isArray(value)
    ? value.map((v) => String(v ?? ""))
    : typeof value === "string"
      ? value.split(/[\n,;]+/)
      : [];
  const seen = new Set<string>();
  for (const raw of parts) {
    const d = raw.trim();
    if (!DATE_RE.test(d)) continue;
    seen.add(d);
  }
  return [...seen].sort().slice(0, 400);
}

function toWeekdayList(value: unknown): number[] {
  const parts: unknown[] = Array.isArray(value) ? value : [];
  const seen = new Set<number>();
  for (const raw of parts) {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 0 && n <= 6) seen.add(n);
  }
  return [...seen].sort((a, b) => a - b);
}

/**
 * The per-weekday hours of a request body: {"1": {"open": "09:00", "close":
 * "13:00"}} or {"1": {open: 540, close: 780}}. A null / "" entry clears that
 * weekday's override and puts it back on the facility's own hours.
 */
function toDayWindows(
  value: unknown
): { ok: true; value: Record<string, DayWindow> } | { ok: false; error: string } {
  const out: Record<string, DayWindow> = {};
  if (value === undefined || value === null || value === "") return { ok: true, value: out };
  if (typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "dayWindows must be an object of weekday → hours" };
  }
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const day = Number(key);
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      return {
        ok: false,
        error: `dayWindows has an invalid weekday “${key}” (0 = Sunday … 6 = Saturday)`,
      };
    }
    if (raw === null || raw === undefined || raw === "") continue;
    if (typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, error: `${WEEKDAY_NAMES[day]}: give both times, or clear the day` };
    }
    const entry = raw as Record<string, unknown>;
    const open = toMinute(entry.open ?? entry.openMin);
    const close = toMinute(entry.close ?? entry.closeMin);
    if (open === null || close === null) {
      return {
        ok: false,
        error: `${WEEKDAY_NAMES[day]}: give both an opening and a closing time (or clear the day)`,
      };
    }
    if (open < 0 || close > 1440 || close - open < SLOT_MIN_MINUTES) {
      return {
        ok: false,
        error: `${WEEKDAY_NAMES[day]}: the hours must be at least ${SLOT_MIN_MINUTES} minutes long, within one day`,
      };
    }
    out[String(day)] = { open, close };
  }
  return { ok: true, value: out };
}

export type NormalisedAvailability =
  | { ok: true; value: Availability }
  | { ok: false; error: string };

/**
 * Validate a submitted availability. Both an integer minute and an "HH:MM"
 * string are accepted, so the API works from the time inputs in the UI and from
 * a script alike.
 */
export function normaliseAvailability(body: Record<string, unknown>): NormalisedAvailability {
  const openMin = toMinute(body.openMin);
  const closeMin = toMinute(body.closeMin);
  if (openMin === null || closeMin === null) {
    return { ok: false, error: "openMin and closeMin are required (minutes or HH:MM)" };
  }
  if (openMin < 0 || closeMin > 1440 || closeMin - openMin < SLOT_MIN_MINUTES) {
    return {
      ok: false,
      error: `The bookable window must be at least ${SLOT_MIN_MINUTES} minutes long, within one day`,
    };
  }
  const dayWindows = toDayWindows(body.dayWindows);
  if (!dayWindows.ok) return { ok: false, error: dayWindows.error };

  return {
    ok: true,
    value: {
      openMin,
      closeMin,
      closedWeekdays: toWeekdayList(body.closedWeekdays),
      closedDates: toDateList(body.closedDates),
      dayWindows: dayWindows.value,
    },
  };
}

/** Short human lines describing a facility's availability (admin/approver UI). */
export function availabilityLines(av: Availability): string[] {
  const lines: string[] = [];
  lines.push(
    av.openMin <= 0 && av.closeMin >= 1440
      ? "Bookable all day (00:00 – 24:00 IST)"
      : `Bookable ${windowLabel(av)}`
  );
  for (const day of ownWindowWeekdays(av)) {
    const w = av.dayWindows[String(day)];
    lines.push(`${weekdayName(day)}s: ${minuteLabel(w.open)} – ${minuteLabel(w.close)} IST`);
  }
  if (av.closedWeekdays.length > 0) {
    lines.push(`Closed every ${av.closedWeekdays.map((d) => weekdayName(d)).join(", ")}`);
  }
  if (av.closedDates.length > 0) {
    lines.push(
      av.closedDates.length === 1
        ? `Closed on ${av.closedDates[0]}`
        : `Closed on ${av.closedDates.length} dates (next: ${av.closedDates[0]})`
    );
  }
  if (
    lines.length === 1 &&
    av.closedWeekdays.length === 0 &&
    av.closedDates.length === 0 &&
    ownWindowWeekdays(av).length === 0
  ) {
    lines.push("No closed days");
  }
  return lines;
}
