"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fmtDuration, fmtMin, fmtSlotRange, slotDurationMin } from "@/lib/ist";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsDown,
  ChevronsUp,
  Clock,
  Globe,
  Headphones,
  Lock,
  Paperclip,
  ShieldCheck,
  User,
  Users,
} from "lucide-react";
import { apiPath } from "sanapp-common-ui";

const CELL_MIN = 15;
const COL_MIN_W = 120; // minimum px per day column (columns expand to fill the container)
const GUTTER_W = 46;

export type BookingBlock = {
  id: string;
  startDate: string;
  endDate: string;
  startMin: number;
  endMin: number;
  label: string;
  bookerName?: string;
  bookerUsername?: string;
  bookerPrimaryRole?: string | null;
  forName?: string | null;
  forUsername?: string | null;
  forPrimaryRole?: string | null;
  purpose?: string | null;
  isPublicPurpose?: boolean;
  pdf?: boolean;
  pdfName?: string | null;
  isPublicAttachment?: boolean;
  needAvSupport?: boolean;
};

export type RangeSelection = {
  startDate: string;
  startMin: number;
  endDate: string;
  endMin: number;
};

export type FocusRequest = {
  range: RangeSelection;
  /** Monotonic counter so repeated clicks on the same range re-trigger scrolling. */
  nonce: number;
};

/** Zoom ladder: label, px per 15-min cell, minutes between gutter marks. */
const ZOOMS: { key: string; label: string; cellH: number; mark: number }[] = [
  { key: "15m", label: "15 min", cellH: 26, mark: 15 },
  { key: "1h", label: "1 h", cellH: 18, mark: 60 },
  { key: "2h", label: "2 h", cellH: 11, mark: 120 },
  { key: "6h", label: "6 h", cellH: 6, mark: 360 },
  { key: "1d", label: "1 d", cellH: 3.5, mark: 360 },
];

function idx(date: string, min: number): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 60000) + min;
}

function rangesOverlap(a: RangeSelection, b: RangeSelection): boolean {
  return (
    idx(a.startDate, a.startMin) < idx(b.endDate, b.endMin) &&
    idx(a.endDate, a.endMin) > idx(b.startDate, b.startMin)
  );
}

/** True when the two ranges overlap or are exactly adjacent (share a boundary). */
function rangesTouch(a: RangeSelection, b: RangeSelection): boolean {
  return (
    idx(a.startDate, a.startMin) <= idx(b.endDate, b.endMin) &&
    idx(a.endDate, a.endMin) >= idx(b.startDate, b.startMin)
  );
}

function dayName(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  return d.toLocaleDateString("en-IN", { weekday: "short" });
}

function fmtDay(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

/** Per-day fragments of a range that intersect the visible days. */
function fragments(
  range: RangeSelection,
  days: string[]
): { date: string; topMin: number; bottomMin: number }[] {
  const out: { date: string; topMin: number; bottomMin: number }[] = [];
  for (const d of days) {
    if (idx(range.endDate, range.endMin) <= idx(d, 0) || idx(range.startDate, range.startMin) >= idx(d, 1440)) {
      continue;
    }
    out.push({
      date: d,
      topMin: d === range.startDate ? range.startMin : 0,
      bottomMin: d === range.endDate ? range.endMin : 1440,
    });
  }
  return out;
}

export function TimeGrid({
  days,
  bookings,
  committed,
  onCommit,
  onReject,
  nowMin,
  todayKey,
  maxHeight,
  focus,
  onAutoAdvance,
  ignoreBookingId = null,
  onUpdateRange,
}: {
  days: string[];
  bookings: BookingBlock[];
  /** Ranges the user has already locked in (blue overlays). */
  committed: RangeSelection[];
  /**
   * Called when a completed drag produces a non-conflicting range.
   * `mergeIndices` lists committed ranges the drag touched/overlapped —
   * they are replaced by the merged union of this drag and those ranges
   * (i.e. the selection is extended).
   */
  onCommit: (range: RangeSelection, mergeIndices?: number[]) => void;
  /** Called when a completed drag conflicts (booking/past) and is rejected. */
  onReject?: (msg?: string) => void;
  nowMin: number;
  todayKey: string;
  /** Scroll-area max height (e.g. "52vh" in dialogs, "60vh" on full pages). */
  maxHeight?: string;
  /** When set (new nonce), the calendar scrolls so this range is visible. */
  focus?: FocusRequest | null;
  /**
   * Called while dragging on the last visible day column (no scroll room) so the
   * caller can advance the week by +7/-7 days — lets a corner-day drag continue
   * into the next/previous week even when all days fit in the viewport.
   */
  onAutoAdvance?: (deltaDays: number) => void;
  /**
   * The booking currently being edited. It is left out of the conflict checks
   * and out of the booked overlays, so its own slot can be moved or resized
   * instead of every attempt failing with "already booked".
   */
  ignoreBookingId?: string | null;
  /**
   * Commit an in-place change to a committed selection (drag its middle to move
   * it, its top/bottom edge to resize). Return a message to reject the change.
   */
  onUpdateRange?: (index: number, range: RangeSelection) => string | null;
}) {
  const [zoomKey, setZoomKey] = useState("1h");
  const zoom = ZOOMS.find((z) => z.key === zoomKey) ?? ZOOMS[1];
  const colHeight = ((24 * 60) / CELL_MIN) * zoom.cellH;
  const [drag, setDrag] = useState<RangeSelection | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const dragFrom = useRef<{ date: string; min: number } | null>(null);
  const isPointerDownRef = useRef(false);
  const pointerStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  // Last pointer position + auto-scroll state used while dragging near the edges.
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const scrollDirRef = useRef<{ h: -1 | 0 | 1; v: -1 | 0 | 1 }>({ h: 0, v: 0 });
  const autoScrollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Always-fresh reference to applyDragFromPointer
  const applyDragRef = useRef<(x: number, y: number) => void>(() => {});
  // Day columns expand to fill the container width (measured from the scroller).
  const [colW, setColW] = useState(COL_MIN_W);

  const [selectedBooking, setSelectedBooking] = useState<BookingBlock | null>(null);

  // While a booking is being edited its own slot must not count as a conflict
  // (nor be drawn as a second, unrelated "booked" block behind the selection).
  const effectiveBookings = useMemo(
    () => (ignoreBookingId ? bookings.filter((b) => b.id !== ignoreBookingId) : bookings),
    [bookings, ignoreBookingId]
  );

  const bookedFragments = useMemo(
    () =>
      effectiveBookings.flatMap((b) =>
        fragments(b, days).map((f) => ({
          ...f,
          label: b.label,
          id: b.id,
          booking: b,
        }))
      ),
    [effectiveBookings, days]
  );

  /** True when a range conflicts with a booking or the past (NOT committed — those merge). */
  function conflict(range: RangeSelection): boolean {
    const inPast = idx(range.startDate, range.startMin) <= idx(todayKey, nowMin);
    if (inPast) return true;
    return effectiveBookings.some((b) => rangesOverlap(range, b));
  }

  // Scroll the calendar so a requested range is visible.
  useEffect(() => {
    if (!focus) return;
    const el = scrollerRef.current;
    if (!el) return;
    const startY = (focus.range.startMin / 1440) * colHeight;
    const max = el.scrollHeight - el.clientHeight;
    el.scrollTop = Math.max(0, Math.min(startY - 80, max));
  }, [focus, colHeight]);

  // Measure the scroller width so day columns expand to fill the available
  // space instead of leaving whitespace on wide screens.
  useEffect(() => {
    const sc = scrollerRef.current;
    if (!sc) return;
    const update = () => {
      const available = Math.max(0, sc.clientWidth - GUTTER_W);
      const next = Math.max(COL_MIN_W, days.length > 0 ? available / days.length : COL_MIN_W);
      setColW((prev) => (Math.abs(prev - next) > 0.5 ? next : prev));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(sc);
    return () => ro.disconnect();
  }, [days.length]);

  /** Resolve a viewport point to a calendar cell (works while the scroller is auto-scrolling). */
  function cellFromXY(clientX: number, clientY: number): { date: string; min: number } | null {
    const el = containerRef.current;
    if (!el || days.length === 0) return null;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left; // containerRef starts after the gutter
    const y = clientY - rect.top; // header is outside the grid container
    const dayIdx = Math.max(0, Math.min(days.length - 1, Math.floor(x / colW)));
    const min = Math.max(0, Math.min(24 * 60 - CELL_MIN, Math.floor(y / zoom.cellH) * CELL_MIN));
    return { date: days[dayIdx], min };
  }

  function cellFromEvent(e: React.PointerEvent): { date: string; min: number } | null {
    return cellFromXY(e.clientX, e.clientY);
  }

  const EDGE_ZONE = 32; // px from a scroller edge that triggers auto-scroll
  const SCROLL_STEP = 12; // px per 16ms tick while dragging near an edge

  /**
   * Extend the drag using the pointer position.
   */
  function applyDragFromPointer(x: number, y: number) {
    if (!dragFrom.current) return;
    const el = containerRef.current;
    if (!el || days.length === 0) return;
    const rect = el.getBoundingClientRect();
    const dayIdx = Math.max(0, Math.min(days.length - 1, Math.floor((x - rect.left) / colW)));
    const py = y - rect.top;
    const min = Math.max(0, Math.min(24 * 60 - CELL_MIN, Math.floor(py / zoom.cellH) * CELL_MIN));
    const endDate = days[dayIdx];

    const ai = idx(dragFrom.current.date, dragFrom.current.min);
    const bi = idx(endDate, min);
    const start = ai <= bi ? dragFrom.current : { date: endDate, min };
    const end = ai <= bi ? { date: endDate, min } : dragFrom.current;
    setDrag({ startDate: start.date, startMin: start.min, endDate: end.date, endMin: end.min + CELL_MIN });
  }
  applyDragRef.current = applyDragFromPointer;

  /** Which way to auto-scroll for a pointer position (0 = inside the edges). */
  function edgeDirFromPointer(clientX: number, clientY: number): { h: -1 | 0 | 1; v: -1 | 0 | 1 } {
    const sc = scrollerRef.current;
    if (!sc) return { h: 0, v: 0 };
    const r = sc.getBoundingClientRect();
    let h: -1 | 0 | 1 = clientX > r.right - EDGE_ZONE ? 1 : clientX < r.left + EDGE_ZONE ? -1 : 0;
    let v: -1 | 0 | 1 = clientY > r.bottom - EDGE_ZONE ? 1 : clientY < r.top + EDGE_ZONE ? -1 : 0;

    if (h === 0 || v === 0) {
      const cell = cellFromXY(clientX, clientY);
      if (cell) {
        if (h === 0) {
          const firstVisible = Math.max(0, Math.floor(sc.scrollLeft / colW));
          const lastVisible = Math.min(
            days.length - 1,
            Math.floor((sc.scrollLeft + sc.clientWidth - GUTTER_W - 24) / colW)
          );
          const dayIdx = days.indexOf(cell.date);
          if (dayIdx >= lastVisible && sc.scrollLeft < sc.scrollWidth - sc.clientWidth - 4) h = 1;
          else if (dayIdx <= firstVisible && sc.scrollLeft > 4) h = -1;
        }
        if (v === 0) {
          const rowH = zoom.cellH;
          const firstVisibleMin = Math.floor(sc.scrollTop / rowH) * CELL_MIN;
          const lastVisibleMin = Math.floor((sc.scrollTop + sc.clientHeight) / rowH) * CELL_MIN;
          if (cell.min >= lastVisibleMin - CELL_MIN && sc.scrollTop < sc.scrollHeight - sc.clientHeight - 4) v = 1;
          else if (cell.min <= firstVisibleMin + CELL_MIN && sc.scrollTop > 4) v = -1;
        }
      }
    }
    return { h, v };
  }


  function startAutoScroll(dir: { h: -1 | 0 | 1; v: -1 | 0 | 1 }) {
    if (dir.h === 0 && dir.v === 0) {
      stopAutoScroll();
      return;
    }
    if (
      autoScrollRef.current !== null &&
      scrollDirRef.current.h === dir.h &&
      scrollDirRef.current.v === dir.v
    ) {
      return;
    }
    stopAutoScroll();
    scrollDirRef.current = dir;
    autoScrollRef.current = setInterval(() => {
      const sc = scrollerRef.current;
      if (!sc) return;
      if (scrollDirRef.current.h !== 0) {
        sc.scrollLeft += scrollDirRef.current.h * SCROLL_STEP;
      }
      if (scrollDirRef.current.v !== 0) sc.scrollTop += scrollDirRef.current.v * SCROLL_STEP;
      if (lastPosRef.current) applyDragRef.current(lastPosRef.current.x, lastPosRef.current.y);
    }, 16);
  }

  function stopAutoScroll() {
    if (autoScrollRef.current !== null) {
      clearInterval(autoScrollRef.current);
      autoScrollRef.current = null;
    }
    scrollDirRef.current = { h: 0, v: 0 };
  }

  // Stop any running auto-scroll when the component unmounts.
  useEffect(() => () => stopAutoScroll(), []);

  function isDisabled(date: string, min: number): boolean {
    if (date === todayKey && min < nowMin) return true;
    const t = idx(date, min);
    return effectiveBookings.some((b) => t >= idx(b.startDate, b.startMin) && t < idx(b.endDate, b.endMin));
  }

  /** Build the normalized range for a completed selection/drag. Supports single-tap (a == b). */
  function normalizeRange(
    a: { date: string; min: number },
    b: { date: string; min: number }
  ): RangeSelection | null {
    const ai = idx(a.date, a.min);
    const bi = idx(b.date, b.min);
    const start = ai <= bi ? a : b;
    const end = ai <= bi ? b : a;
    const range: RangeSelection = {
      startDate: start.date,
      startMin: start.min,
      endDate: end.date,
      endMin: end.min + CELL_MIN, // include the whole end cell
    };
    if (idx(range.endDate, range.endMin) <= idx(range.startDate, range.startMin)) return null;
    return range;
  }

  /* ------------------------------------------------------------------
     In-place editing of a committed (locked-in) selection.
     Drag the middle of the block to move the slot (time and/or day); drag its
     top or bottom edge to shorten or extend it. The gesture is driven by
     pointer events, so mouse, trackpad and touch all behave the same.
     ------------------------------------------------------------------ */
  const [grab, setGrab] = useState<{
    index: number;
    mode: "move" | "start" | "end";
    originX: number;
    originY: number;
    base: RangeSelection;
  } | null>(null);
  const [grabPreview, setGrabPreview] = useState<RangeSelection | null>(null);
  // Pointer position while a slot is moved/resized — drives the live tooltip so
  // the new time and duration are visible during the gesture.
  const [grabPos, setGrabPos] = useState<{ x: number; y: number } | null>(null);
  // Mirror of the live preview so the pointerup handler commits what the user
  // is actually looking at (state updates are async).
  const grabPreviewRef = useRef<RangeSelection | null>(null);
  // Element that holds the pointer capture for the running grab (released on up).
  const grabTargetRef = useRef<Element | null>(null);
  function setPreview(next: RangeSelection | null) {
    grabPreviewRef.current = next;
    setGrabPreview(next);
  }

  /** Start moving/resizing committed range `index`. */
  function startGrab(index: number, mode: "move" | "start" | "end", e: React.PointerEvent) {
    if (!onUpdateRange) return;
    const base = committed[index];
    if (!base) return;
    e.stopPropagation();
    e.preventDefault();
    dragFrom.current = null;
    isPointerDownRef.current = false;
    setGrab({ index, mode, originX: e.clientX, originY: e.clientY, base });
    setGrabPos({ x: e.clientX, y: e.clientY });
    setPreview(base);
    // Explicit capture (not just the implicit one a touch pointer may or may not
    // get): the gesture then keeps receiving move/up even when the pointer
    // leaves the block, so a resize can never get stuck half-way.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
      grabTargetRef.current = e.currentTarget;
    } catch {
      /* pointer capture is optional */
    }
  }

  // Absolute-minute helpers: a range is `[startMinute, endMinute)` counted from
  // an epoch day, so day changes are just multiples of 1440.
  function toAbs(date: string, min: number): number {
    return idx(date, min);
  }
  function fromAbs(abs: number): { date: string; min: number } {
    const dayStart = Math.floor(abs / 1440) * 1440;
    return { date: new Date(dayStart * 60000).toISOString().slice(0, 10), min: abs - dayStart };
  }

  useEffect(() => {
    if (!grab) return;
    // One 15-minute cell is zoom.cellH pixels tall, so `round(dy / cellH)`
    // is the number of cells moved; a whole day column is colW pixels wide.
    const cellsMoved = (px: number) => Math.round(px / zoom.cellH);
    const daysMoved = (px: number) => Math.round(px / colW);
    const build = (clientX: number, clientY: number): RangeSelection => {
      const delta = cellsMoved(clientY - grab.originY) * CELL_MIN + daysMoved(clientX - grab.originX) * 1440;
      const s = toAbs(grab.base.startDate, grab.base.startMin);
      const e = toAbs(grab.base.endDate, grab.base.endMin);
      const lo = toAbs(days[0] ?? grab.base.startDate, 0);
      const hi = toAbs(days[days.length - 1] ?? grab.base.endDate, 1440);
      if (grab.mode === "move") {
        const dur = e - s;
        const ns = Math.max(lo, Math.min(hi - dur, s + delta));
        const start = fromAbs(ns);
        const end = fromAbs(ns + dur);
        return { startDate: start.date, startMin: start.min, endDate: end.date, endMin: end.min };
      }
      if (grab.mode === "start") {
        const ns = Math.max(lo, Math.min(e - CELL_MIN, s + delta));
        const start = fromAbs(ns);
        return {
          startDate: start.date,
          startMin: start.min,
          endDate: grab.base.endDate,
          endMin: grab.base.endMin,
        };
      }
      const ne = Math.max(s + CELL_MIN, Math.min(hi, e + delta));
      const end = fromAbs(ne);
      return {
        startDate: grab.base.startDate,
        startMin: grab.base.startMin,
        endDate: end.date,
        endMin: end.min,
      };
    };
    const onMove = (ev: PointerEvent) => {
      setGrabPos({ x: ev.clientX, y: ev.clientY });
      setPreview(build(ev.clientX, ev.clientY));
      if (typeof window !== "undefined") window.getSelection?.()?.removeAllRanges();
    };
    const onUp = (ev: PointerEvent) => {
      try {
        const el = grabTargetRef.current;
        if (el?.hasPointerCapture(ev.pointerId)) el.releasePointerCapture(ev.pointerId);
      } catch {
        /* ignore */
      }
      grabTargetRef.current = null;
      const next = grabPreviewRef.current;
      const current = grab;
      setGrab(null);
      setGrabPos(null);
      setPreview(null);
      if (!onUpdateRange || !next || !current) return;
      const err = onUpdateRange(current.index, next);
      if (err) onReject?.(err);
    };
    // Capture phase on purpose: the selection block stops propagation of its own
    // pointermove/pointerup (React handlers), which would otherwise stop these
    // listeners from ever firing and leave the gesture doing nothing at all.
    const opts = { capture: true } as const;
    window.addEventListener("pointermove", onMove, opts);
    window.addEventListener("pointerup", onUp, opts);
    window.addEventListener("pointercancel", onUp, opts);
    return () => {
      window.removeEventListener("pointermove", onMove, opts);
      window.removeEventListener("pointerup", onUp, opts);
      window.removeEventListener("pointercancel", onUp, opts);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grab, zoom.cellH, colW, days, onUpdateRange, onReject]);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const cell = cellFromEvent(e);
    if (!cell) return;
    if (cell.date < todayKey || (cell.date === todayKey && cell.min < nowMin)) {
      onReject?.("You cannot book a slot in the past (Indian Standard Time).");
      return;
    }
    if (isDisabled(cell.date, cell.min)) {
      onReject?.("That slot is already booked or unavailable.");
      return;
    }
    
    isPointerDownRef.current = true;
    pointerStartPosRef.current = { x: e.clientX, y: e.clientY };
    dragFrom.current = cell;
    lastPosRef.current = { x: e.clientX, y: e.clientY };
    stopAutoScroll();

    setDrag({ startDate: cell.date, startMin: cell.min, endDate: cell.date, endMin: cell.min + CELL_MIN });
    setDragPos({ x: e.clientX, y: e.clientY });

    try {
      containerRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* pointer capture is optional */
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!isPointerDownRef.current || !dragFrom.current) return;
    lastPosRef.current = { x: e.clientX, y: e.clientY };
    setDragPos({ x: e.clientX, y: e.clientY });

    // Ignore tiny jitter movements
    if (pointerStartPosRef.current) {
      const dx = Math.abs(e.clientX - pointerStartPosRef.current.x);
      const dy = Math.abs(e.clientY - pointerStartPosRef.current.y);
      if (dx < 4 && dy < 4) {
        return;
      }
    }

    startAutoScroll(edgeDirFromPointer(e.clientX, e.clientY));
    applyDragFromPointer(e.clientX, e.clientY);
  }

  function commitFinalRange(from: { date: string; min: number }, cur: RangeSelection) {
    const range = normalizeRange(from, { date: cur.endDate, min: cur.endMin - CELL_MIN });
    if (!range) return;
    if (range.startDate < todayKey || (range.startDate === todayKey && range.startMin < nowMin)) {
      onReject?.("You cannot book a slot in the past (Indian Standard Time).");
      return;
    }
    if (conflict(range)) {
      onReject?.("That range overlaps an already-booked slot.");
      return;
    }

    // Extend: merge the selection with any committed range it touches or overlaps.
    const mergeIdx = committed.map((c, i) => (rangesTouch(c, range) ? i : -1)).filter((i) => i >= 0);
    if (mergeIdx.length > 0) {
      const union = mergeIdx.reduce<RangeSelection>((u, i) => {
        const c = committed[i];
        const uS = idx(u.startDate, u.startMin);
        const uE = idx(u.endDate, u.endMin);
        const cS = idx(c.startDate, c.startMin);
        const cE = idx(c.endDate, c.endMin);
        const start = uS <= cS ? u : c;
        const end = uE >= cE ? u : c;
        return { startDate: start.startDate, startMin: start.startMin, endDate: end.endDate, endMin: end.endMin };
      }, range);
      onCommit(union, mergeIdx);
      return;
    }

    onCommit(range);
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    stopAutoScroll();
    try {
      if (containerRef.current?.hasPointerCapture(e.pointerId)) {
        containerRef.current.releasePointerCapture(e.pointerId);
      }
    } catch {
      /* ignore */
    }

    if (!dragFrom.current) {
      isPointerDownRef.current = false;
      pointerStartPosRef.current = null;
      setDrag(null);
      setDragPos(null);
      return;
    }

    const from = dragFrom.current;
    let cur = drag;
    const startPos = pointerStartPosRef.current;
    dragFrom.current = null;
    isPointerDownRef.current = false;
    pointerStartPosRef.current = null;
    setDrag(null);
    setDragPos(null);

    if (!cur) return;

    // Check if it was a single tap (< 6px movement)
    if (startPos) {
      const dx = Math.abs(e.clientX - startPos.x);
      const dy = Math.abs(e.clientY - startPos.y);
      if (dx < 6 && dy < 6) {
        // Tapped a single slot: default to 1-hour slot (or max available without conflict)
        const preferredEndMin = Math.min(24 * 60, from.min + 60);
        const tapRange: RangeSelection = {
          startDate: from.date,
          startMin: from.min,
          endDate: from.date,
          endMin: preferredEndMin,
        };
        if (!conflict(tapRange)) {
          cur = tapRange;
        }
      }
    }

    commitFinalRange(from, cur);
  }

  function handlePointerCancel(e: React.PointerEvent<HTMLDivElement>) {
    stopAutoScroll();
    try {
      if (containerRef.current?.hasPointerCapture(e.pointerId)) {
        containerRef.current.releasePointerCapture(e.pointerId);
      }
    } catch {
      /* ignore */
    }

    dragFrom.current = null;
    isPointerDownRef.current = false;
    pointerStartPosRef.current = null;
    setDrag(null);
    setDragPos(null);
  }

  const marks = Array.from({ length: (24 * 60) / CELL_MIN }, (_, i) => i * CELL_MIN).filter((m) => m % zoom.mark === 0);

  function scrollToMinute(min: number) {
    if (!scrollerRef.current) return;
    const targetY = (min / (24 * 60)) * colHeight - 30;
    scrollerRef.current.scrollTo({ top: Math.max(0, targetY), behavior: "smooth" });
  }

  function scrollVertical(dir: "top" | "bottom" | "up" | "down") {
    if (!scrollerRef.current) return;
    if (dir === "top") {
      scrollerRef.current.scrollTo({ top: 0, behavior: "smooth" });
    } else if (dir === "bottom") {
      scrollerRef.current.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
    } else if (dir === "up") {
      scrollerRef.current.scrollBy({ top: -200, behavior: "smooth" });
    } else if (dir === "down") {
      scrollerRef.current.scrollBy({ top: 200, behavior: "smooth" });
    }
  }

  function scrollHorizontal(dir: "left" | "right") {
    if (!scrollerRef.current) return;
    const delta = dir === "left" ? -colW * 2 : colW * 2;
    scrollerRef.current.scrollBy({ left: delta, behavior: "smooth" });
  }

  return (
    <div>
      {/* Quick Jump & Multi-Direction Scroll Navigation Bar */}
      <div className="mb-2 flex flex-col gap-2 bg-muted/30 p-2 rounded-lg border">
        {/* Row 1: Quick Time Jumper Buttons */}
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-none py-0.5 max-w-full">
          <span className="text-[11px] text-muted-foreground font-semibold mr-0.5 shrink-0 flex items-center gap-1">
            <Clock className="h-3.5 w-3.5 text-primary" /> Jump:
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2.5 text-[11px] font-semibold shrink-0 border bg-background hover:bg-muted"
            onClick={() => scrollToMinute(0)}
            title="Jump to 00:00 (12:00 AM midnight)"
          >
            00:00 AM
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2.5 text-[11px] font-bold shrink-0 bg-primary/10 hover:bg-primary/20 border-primary/40 text-primary"
            onClick={() => scrollToMinute(nowMin)}
            title="Jump to current IST time"
          >
            Now ({fmtMin(nowMin)})
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px] shrink-0 border bg-background hover:bg-muted"
            onClick={() => scrollToMinute(8 * 60)}
            title="Jump to Morning (8:00 AM)"
          >
            Morning (8 AM)
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px] shrink-0 border bg-background hover:bg-muted"
            onClick={() => scrollToMinute(13 * 60)}
            title="Jump to Afternoon (1:00 PM)"
          >
            Afternoon (1 PM)
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px] shrink-0 border bg-background hover:bg-muted"
            onClick={() => scrollToMinute(18 * 60)}
            title="Jump to Evening (6:00 PM)"
          >
            Evening (6 PM)
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px] shrink-0 border bg-background hover:bg-muted"
            onClick={() => scrollToMinute(22 * 60)}
            title="Jump to Night (10:00 PM)"
          >
            Night (10 PM)
          </Button>
        </div>

        {/* Row 2: Scroll Direction Helpers (Top, Bottom, Up, Down, Left, Right) */}
        <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1.5 border-t border-border/50">
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-none py-0.5">
            <span className="text-[11px] text-muted-foreground font-medium mr-1 shrink-0">
              Scroll:
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px] shrink-0 flex items-center gap-1 font-semibold bg-background"
              onClick={() => scrollVertical("top")}
              title="Scroll to very Top (12:00 AM)"
            >
              <ChevronsUp className="h-3.5 w-3.5 text-primary" />
              <span>Top</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px] shrink-0 flex items-center gap-1 font-medium bg-background"
              onClick={() => scrollVertical("up")}
              title="Scroll Up (earlier hours)"
            >
              <ChevronUp className="h-3.5 w-3.5" />
              <span>Up</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px] shrink-0 flex items-center gap-1 font-medium bg-background"
              onClick={() => scrollVertical("down")}
              title="Scroll Down (later hours)"
            >
              <ChevronDown className="h-3.5 w-3.5" />
              <span>Down</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px] shrink-0 flex items-center gap-1 font-semibold bg-background"
              onClick={() => scrollVertical("bottom")}
              title="Scroll to very Bottom (11:59 PM)"
            >
              <ChevronsDown className="h-3.5 w-3.5 text-primary" />
              <span>Bottom</span>
            </Button>
          </div>

          {days.length > 1 && (
            <div className="flex items-center gap-1 shrink-0">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2 text-[11px] shrink-0 flex items-center gap-1 font-medium bg-background"
                onClick={() => scrollHorizontal("left")}
                title="Scroll Left (earlier days)"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                <span>Left</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2 text-[11px] shrink-0 flex items-center gap-1 font-medium bg-background"
                onClick={() => scrollHorizontal("right")}
                title="Scroll Right (next days)"
              >
                <span>Right</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm border-2 border-primary bg-primary/25" /> Tap or drag to select
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm border-2 border-primary bg-primary" /> Selected —
            drag the middle to move, the top/bottom edge to shorten or extend
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm bg-red-500/20 border border-red-400" /> Already booked
          </span>
        </p>
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-none pb-0.5">
          <span className="text-[11px] text-muted-foreground mr-1 hidden sm:inline">Zoom:</span>
          {ZOOMS.map((z) => (
            <Button
              key={z.key}
              type="button"
              variant={zoom.key === z.key ? "secondary" : "outline"}
              size="sm"
              className="h-7 px-2 text-[11px] shrink-0"
              onClick={() => setZoomKey(z.key)}
              title={`Zoom: ${z.label} marks`}
            >
              {z.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Live from–to tooltip while dragging */}
      {drag && dragPos && (() => {
        const dur = slotDurationMin(drag.startDate, drag.startMin, drag.endDate, drag.endMin);
        const isMulti = drag.startDate !== drag.endDate;
        return (
          <div
            className="pointer-events-none fixed z-50 rounded-md border bg-card px-3 py-1.5 text-xs font-semibold text-foreground shadow-xl flex items-center gap-2"
            style={{
              left: Math.max(10, Math.min((typeof window !== "undefined" ? window.innerWidth : 400) - 240, dragPos.x - 60)),
              top: Math.max(10, dragPos.y - 45),
            }}
          >
            <span>
              {isMulti
                ? `${fmtDay(drag.startDate)} ${fmtMin(drag.startMin)} → ${fmtDay(drag.endDate)} ${fmtMin(drag.endMin)}`
                : `${fmtDay(drag.startDate)} (${fmtMin(drag.startMin)} – ${fmtMin(drag.endMin)})`}
            </span>
            <span className="px-1.5 py-0.5 rounded bg-primary text-primary-foreground text-[10px] font-bold shrink-0">
              {fmtDuration(dur)}
            </span>
          </div>
        );
      })()}

      {/* Live from–to tooltip while a selected slot is moved or resized, so the
          new time and duration are visible mid-gesture (mouse and touch). */}
      {grab && grabPreview && grabPos && (() => {
        const dur = slotDurationMin(grabPreview.startDate, grabPreview.startMin, grabPreview.endDate, grabPreview.endMin);
        const label =
          grabPreview.startDate === grabPreview.endDate
            ? `${fmtMin(grabPreview.startMin)} – ${fmtMin(grabPreview.endMin)}`
            : `${fmtDay(grabPreview.startDate)} ${fmtMin(grabPreview.startMin)} → ${fmtDay(grabPreview.endDate)} ${fmtMin(grabPreview.endMin)}`;
        return (
          <div
            className="pointer-events-none fixed z-50 rounded-md border bg-card px-3 py-1.5 text-xs font-semibold text-foreground shadow-xl flex items-center gap-2"
            style={{
              left: Math.max(10, Math.min((typeof window !== "undefined" ? window.innerWidth : 400) - 240, grabPos.x - 60)),
              top: Math.max(10, grabPos.y - 45),
            }}
          >
            <span>{label}</span>
            <span className="px-1.5 py-0.5 rounded bg-primary text-primary-foreground text-[10px] font-bold shrink-0">
              {fmtDuration(dur)}
            </span>
            <span className="text-[10px] font-medium text-muted-foreground shrink-0">
              {grab.mode === "move" ? "Moving" : grab.mode === "start" ? "Start" : "End"}
            </span>
          </div>
        );
      })()}

      <div ref={scrollerRef} className="overflow-auto rounded-lg border bg-card fb-scroller" style={{ maxHeight: maxHeight ?? "52vh" }}>
        {/* Day header (sticky) — today is bold */}
        <div className="sticky top-0 z-20 flex bg-card border-b">
          <div style={{ width: GUTTER_W }} className="shrink-0" />
          {days.map((d) => (
            <div
              key={d}
              style={{ width: colW }}
              className={`shrink-0 px-2 py-1.5 text-center border-r select-none ${
                d === todayKey ? "text-primary font-bold bg-primary/5" : "text-muted-foreground"
              }`}
            >
              <div className="text-xs font-medium">
                {dayName(d)}
                {d === todayKey && <span className="ml-1 text-[9px] font-bold uppercase tracking-wide">Today</span>}
              </div>
              <div className="text-[10px]">{fmtDay(d)}</div>
            </div>
          ))}
        </div>
        <div className="flex">
          {/* Time gutter */}
          <div style={{ width: GUTTER_W, height: colHeight }} className="shrink-0 relative select-none">
            {marks.map((m) => (
              <div
                key={m}
                style={{ height: (CELL_MIN / (24 * 60)) * colHeight, top: (m / (24 * 60)) * colHeight }}
                className={`absolute right-1 -translate-y-1/2 text-muted-foreground pointer-events-none ${
                  zoom.mark <= 15 ? "text-[8px]" : "text-[10px] font-semibold"
                }`}
              >
                {fmtMin(m)}
              </div>
            ))}
          </div>
          {/* Day columns */}
          <div
            ref={containerRef}
            className="relative flex select-none touch-none fb-grid"
            style={{ height: colHeight, touchAction: "none" }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
          >
            {days.map((d) => (
              <div key={d} className="shrink-0 relative border-r" style={{ width: colW, height: colHeight }}>
                {/* grid lines at the zoom's mark interval */}
                {marks.map((m) => (
                  <div
                    key={m}
                    className="absolute left-0 right-0 border-t pointer-events-none"
                    style={{
                      top: (m / (24 * 60)) * colHeight,
                      borderColor: m % 60 === 0 ? "var(--iipe-border)" : "rgba(0,0,0,0.04)",
                    }}
                  />
                ))}
                {/* Current time marker on today's column */}
                {d === todayKey && nowMin < 24 * 60 && (
                  <div
                    className="fb-now"
                    title={`Now: ${fmtMin(nowMin)} IST`}
                    style={{ top: (nowMin / (24 * 60)) * colHeight - 1 }}
                  />
                )}
              </div>
            ))}

            {/* Booked overlays */}
            {bookedFragments.map((f) => {
              const b = f.booking;
              const totalDur = slotDurationMin(b.startDate, b.startMin, b.endDate, b.endMin);
              const isMultiDay = b.startDate !== b.endDate;
              const heightPx = Math.max(16, ((f.bottomMin - f.topMin) / (24 * 60)) * colHeight - 2);
              const isShort = heightPx < 32;
              const durDisplay = fmtDuration(totalDur);
              const timeDisplay = isMultiDay
                ? `${fmtDay(b.startDate)} ${fmtMin(b.startMin)} → ${fmtDay(b.endDate)} ${fmtMin(b.endMin)}`
                : `${fmtMin(b.startMin)}–${fmtMin(b.endMin)}`;

              return (
                <div
                  key={f.id + f.date}
                  className="fb-booked pointer-events-auto hover:brightness-90 transition-all shadow-xs"
                  role="button"
                  tabIndex={0}
                  onPointerDown={(e) => {
                    // Keep the tap for the details modal instead of starting a
                    // new selection underneath the booking.
                    e.stopPropagation();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedBooking(b);
                    }
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedBooking(b);
                  }}
                  title={`Booked: ${fmtSlotRange(b.startDate, b.startMin, b.endDate, b.endMin)} (${durDisplay})\nBooked by: ${b.bookerName || "User"}${b.forName ? ` on behalf of ${b.forName}` : ""}\nClick to view booking details`}
                  style={{
                    left: days.indexOf(f.date) * colW + 2,
                    width: colW - 4,
                    top: (f.topMin / (24 * 60)) * colHeight + 1,
                    height: heightPx,
                  }}
                >
                  <div className="flex flex-col justify-start w-full overflow-hidden leading-tight">
                    {/* Time and duration header */}
                    <div className="flex items-center justify-between gap-1 text-[10px] font-bold text-foreground truncate mb-0.5">
                      <span className="truncate flex items-center gap-0.5">
                        <Clock className="h-2.5 w-2.5 shrink-0 text-red-600 dark:text-red-400 inline" />
                        <span>{timeDisplay}</span>
                      </span>
                      <span className="shrink-0 px-1 py-0.2 rounded text-[9px] font-bold bg-red-500/15 text-red-700 dark:text-red-300 border border-red-500/30">
                        {durDisplay}
                      </span>
                    </div>

                    {/* Primary line: Name & Username */}
                    <div className="flex items-center gap-1 font-semibold text-[11px] truncate text-foreground">
                      <span className="truncate">
                        {b.forName ? `${b.forName} (@${b.forUsername})` : b.bookerName ? `${b.bookerName} (@${b.bookerUsername})` : b.label}
                      </span>
                      {b.needAvSupport && (
                        <span
                          title="AV Technician Support Requested"
                          className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-amber-500 text-white font-bold text-[9px] shrink-0 leading-none shadow-xs animate-pulse"
                        >
                          <Headphones className="h-2.5 w-2.5" />
                          <span>AV</span>
                        </span>
                      )}
                      {b.pdf && (
                        <span title="Has attachment" className="inline-flex shrink-0">
                          <Paperclip className="h-3 w-3 text-primary" />
                        </span>
                      )}
                    </div>

                    {/* Role & Booker details */}
                    {!isShort && (
                      <div className="text-[10px] text-muted-foreground truncate flex items-center gap-1 mt-0.5">
                        <span className="font-medium text-foreground/80">
                          {b.forName ? b.forPrimaryRole || "User" : b.bookerPrimaryRole || "User"}
                        </span>
                        {b.forName && (
                          <span className="truncate opacity-80">
                            · by {b.bookerName}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Purpose preview if space permits */}
                    {heightPx > 54 && b.purpose && (
                      <div className="text-[9px] text-muted-foreground italic truncate mt-0.5 opacity-90">
                        &quot;{b.purpose}&quot;
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Committed selection overlays — draggable to move/resize */}
            {committed.map((r, i) => (
              <SelectionOverlay
                key={`c${i}`}
                range={r}
                days={days}
                colW={colW}
                colHeight={colHeight}
                conflict={conflict(r)}
                solid
                index={i}
                interactive={Boolean(onUpdateRange)}
                dimmed={grab !== null && grab.index === i}
                onGrab={startGrab}
              />
            ))}

            {/* Live preview of the slot being moved/resized */}
            {grabPreview && grab && (
              <SelectionOverlay
                range={grabPreview}
                days={days}
                colW={colW}
                colHeight={colHeight}
                conflict={false}
                solid
              />
            )}

            {/* Current drag overlay */}
            {drag && <SelectionOverlay range={drag} days={days} colW={colW} colHeight={colHeight} conflict={conflict(drag)} />}
          </div>
        </div>
      </div>

      {/* Booked Slot Details Modal */}
      <Dialog open={selectedBooking !== null} onOpenChange={(o) => { if (!o) setSelectedBooking(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              Booking Details
            </DialogTitle>
            <DialogDescription asChild>
              <div className="flex flex-col gap-1.5 mt-1 text-xs text-muted-foreground">
                <div className="font-semibold text-foreground text-sm">
                  {selectedBooking && fmtSlotRange(selectedBooking.startDate, selectedBooking.startMin, selectedBooking.endDate, selectedBooking.endMin)}
                </div>
                {selectedBooking && (() => {
                  const totalDur = slotDurationMin(selectedBooking.startDate, selectedBooking.startMin, selectedBooking.endDate, selectedBooking.endMin);
                  return (
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded border border-primary/20">
                        Duration: {fmtDuration(totalDur)}
                      </span>
                      <span>•</span>
                      <span>From: <strong>{selectedBooking.startDate}</strong> {fmtMin(selectedBooking.startMin)} IST</span>
                      <span>→</span>
                      <span>To: <strong>{selectedBooking.endDate}</strong> {fmtMin(selectedBooking.endMin)} IST</span>
                    </div>
                  );
                })()}
              </div>
            </DialogDescription>
          </DialogHeader>

          {selectedBooking && (
            <div className="space-y-3 py-2 text-sm">
              {/* AV Support Alert Badge */}
              {selectedBooking.needAvSupport && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 flex items-start gap-2.5 text-amber-950 shadow-xs">
                  <Headphones className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-semibold text-xs text-amber-900 uppercase tracking-wider flex items-center gap-1.5">
                      <span>AV Technician Support Requested</span>
                      <Badge className="bg-amber-600 text-white text-[10px] px-1.5 py-0 h-4">Required</Badge>
                    </div>
                    <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                      The booker has requested on-site AV technician assistance for this time slot. AV technicians should be prepared.
                    </p>
                  </div>
                </div>
              )}

              {/* Booker Information */}
              <div className="rounded-lg border bg-muted/40 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-primary" />
                  <span className="font-semibold text-xs text-muted-foreground uppercase tracking-wider">Booked By</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Name:</span>
                    <span className="font-semibold text-foreground text-sm">{selectedBooking.bookerName || "Unknown"}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[11px]">User ID:</span>
                    <span className="font-mono font-medium text-foreground">@{selectedBooking.bookerUsername || "—"}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-muted-foreground block text-[11px]">Primary Role:</span>
                    <Badge variant="secondary" className="mt-0.5 text-xs font-semibold">
                      {selectedBooking.bookerPrimaryRole || "USER"}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* On Behalf Of Information (if applicable) */}
              {selectedBooking.forName && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-amber-700" />
                    <span className="font-semibold text-xs text-amber-800 uppercase tracking-wider">Blocked On Behalf Of</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground block text-[11px]">Name:</span>
                      <span className="font-semibold text-foreground text-sm">{selectedBooking.forName}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[11px]">User ID:</span>
                      <span className="font-mono font-medium text-foreground">@{selectedBooking.forUsername || "—"}</span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-muted-foreground block text-[11px]">Primary Role:</span>
                      <Badge variant="outline" className="mt-0.5 text-xs font-semibold border-amber-300 bg-amber-100/60 text-amber-900">
                        {selectedBooking.forPrimaryRole || "USER"}
                      </Badge>
                    </div>
                  </div>
                </div>
              )}

              {/* Description / Purpose */}
              <div className="rounded-lg border p-3 space-y-1.5 bg-card">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    {selectedBooking.isPublicPurpose ? (
                      <>
                        <Globe className="h-3.5 w-3.5 text-emerald-600" />
                        <span>Description (Public)</span>
                      </>
                    ) : (
                      <>
                        <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                        <span>Description (Private)</span>
                      </>
                    )}
                  </span>
                  <Badge variant={selectedBooking.isPublicPurpose ? "outline" : "secondary"} className="text-[10px]">
                    {selectedBooking.isPublicPurpose ? "Viewable by all" : "Private"}
                  </Badge>
                </div>
                {selectedBooking.purpose ? (
                  <p className="text-xs text-foreground whitespace-pre-wrap bg-muted/30 p-2 rounded border">
                    {selectedBooking.purpose}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground italic flex items-center gap-1 py-1">
                    <Lock className="h-3 w-3" />
                    <span>Description is private to booker and administrators.</span>
                  </p>
                )}
              </div>

              {/* Attachment */}
              <div className="rounded-lg border p-3 space-y-2 bg-card">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Paperclip className="h-3.5 w-3.5 text-primary" />
                    <span>Attachment</span>
                  </span>
                  {selectedBooking.pdf && (
                    <Badge variant={selectedBooking.isPublicAttachment ? "outline" : "secondary"} className="text-[10px]">
                      {selectedBooking.isPublicAttachment ? "Public" : "Private"}
                    </Badge>
                  )}
                </div>
                {selectedBooking.pdf ? (
                  <Button asChild variant="outline" size="sm" className="w-full gap-1.5 text-xs text-primary border-primary/30">
                    <a
                      href={apiPath(`/api/bookings/${selectedBooking.id}/pdf`)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Paperclip className="h-3.5 w-3.5" />
                      <span>{selectedBooking.pdfName || "View attached PDF"}</span>
                    </a>
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground italic">
                    {selectedBooking.isPublicAttachment ? "No attachment uploaded." : "No attachment uploaded (or private)."}
                  </p>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSelectedBooking(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SelectionOverlay({
  range,
  days,
  colW,
  colHeight,
  conflict,
  solid = false,
  index,
  interactive = false,
  dimmed = false,
  onGrab,
}: {
  range: RangeSelection;
  days: string[];
  colW: number;
  colHeight: number;
  conflict: boolean;
  solid?: boolean;
  /** Position of this range in the committed list (needed to drag-edit it). */
  index?: number;
  /** Render move + resize affordances (committed ranges only). */
  interactive?: boolean;
  /** True while this range is being dragged (the preview takes over). */
  dimmed?: boolean;
  onGrab?: (index: number, mode: "move" | "start" | "end", e: React.PointerEvent) => void;
}) {
  const frags = fragments(range, days);
  const totalDur = slotDurationMin(range.startDate, range.startMin, range.endDate, range.endMin);
  const isMultiDay = range.startDate !== range.endDate;
  const durDisplay = fmtDuration(totalDur);

  return (
    <>
      {frags.map((f) => {
        const heightPx = Math.max(16, ((f.bottomMin - f.topMin) / (24 * 60)) * colHeight - 2);
        const isShort = heightPx < 32;

        let timeLabel = "";
        if (!isMultiDay) {
          timeLabel = `${fmtMin(range.startMin)} – ${fmtMin(range.endMin)}`;
        } else if (f.date === range.startDate) {
          timeLabel = `From ${fmtMin(range.startMin)}`;
        } else if (f.date === range.endDate) {
          timeLabel = `To ${fmtMin(range.endMin)}`;
        } else {
          timeLabel = "All day";
        }

        const draggable = solid && interactive && typeof index === "number" && Boolean(onGrab);
        const firstFragment = f.date === frags[0]?.date;
        const lastFragment = f.date === frags[frags.length - 1]?.date;
        // Resizing is decided by *where* the pointer lands, not by hitting a thin
        // bar: the top ~30% of the block (capped at 20px) shortens/extends the
        // start, the bottom matches for the end, and the middle moves the slot.
        // That makes the gesture work the same with a mouse and with a finger,
        // where a 9-14px handle is nearly impossible to hit.
        const edgeZone = Math.max(6, Math.min(20, Math.round(heightPx * 0.3)));
        const handleH = Math.max(8, Math.min(18, Math.round(heightPx * 0.3)));
        /** Which gesture a pointer at `clientY` inside this block should start. */
        const modeAt = (el: HTMLElement, clientY: number): "move" | "start" | "end" => {
          const rect = el.getBoundingClientRect();
          const y = clientY - rect.top;
          if (firstFragment && y <= edgeZone) return "start";
          if (lastFragment && y >= rect.height - edgeZone) return "end";
          return "move";
        };
        const handleBlockPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
          onGrab!(index!, modeAt(e.currentTarget, e.clientY), e);
        };

        return (
          <div
            key={f.date}
            className={`fb-selection flex flex-col justify-start overflow-hidden p-1 text-white font-semibold shadow-xs${
              draggable ? " fb-selection-solid" : ""
            }${draggable && dimmed ? " fb-selection-dragging" : ""}`}
            title={`Selected: ${fmtSlotRange(range.startDate, range.startMin, range.endDate, range.endMin)} (${durDisplay})${
              draggable ? "\nDrag the middle to move · drag the top/bottom edge to shorten or extend" : ""
            }`}
            onPointerDown={draggable ? handleBlockPointerDown : undefined}
            onPointerMove={
              draggable
                ? (e) => {
                    // Keep the grid from starting a fresh selection underneath,
                    // then (mouse only) advertise the resize cursor at the edges.
                    e.stopPropagation();
                    if (e.pointerType !== "mouse") return;
                    e.currentTarget.style.cursor =
                      modeAt(e.currentTarget, e.clientY) === "move" ? "grab" : "ns-resize";
                  }
                : undefined
            }
            onPointerUp={draggable ? (e) => e.stopPropagation() : undefined}
            style={{
              left: days.indexOf(f.date) * colW + 1,
              width: colW - 2,
              top: (f.topMin / (24 * 60)) * colHeight + 1,
              height: heightPx,
              ...(solid
                ? { borderColor: "var(--iipe-primary)", background: "color-mix(in srgb, var(--iipe-primary) 65%, #051b14)" }
                : {}),
              ...(conflict
                ? { borderColor: "var(--iipe-danger)", background: "color-mix(in srgb, var(--iipe-danger) 60%, #1a0000)" }
                : {}),
            }}
          >
            {/* Primary line: Time range and Duration */}
            <div className="flex items-center justify-between gap-1 w-full text-[10px] font-bold leading-tight pointer-events-none">
              <span className="truncate bg-black/40 px-1 py-0.5 rounded text-white shadow-xs">
                {timeLabel}
              </span>
              <span className="shrink-0 text-[9px] font-extrabold px-1 py-0.5 rounded bg-white text-primary shadow-xs">
                {durDisplay}
              </span>
            </div>

            {/* Sub-label on multi-day or larger blocks */}
            {!isShort && isMultiDay && (
              <div className="text-[9px] text-white/95 font-medium truncate mt-0.5 bg-black/30 px-1 py-0.5 rounded pointer-events-none">
                {f.date === range.startDate
                  ? `Ends ${fmtDay(range.endDate)} ${fmtMin(range.endMin)}`
                  : `Starts ${fmtDay(range.startDate)} ${fmtMin(range.startMin)}`}
              </div>
            )}

            {/* Resize bars: top on the first visible day, bottom on the last,
                so a multi-day selection can be shortened from either end. */}
            {draggable && firstFragment && (
              <span className="fb-resize-handle fb-resize-top" aria-hidden="true" style={{ height: handleH }} />
            )}
            {draggable && lastFragment && (
              <span className="fb-resize-handle fb-resize-bottom" aria-hidden="true" style={{ height: handleH }} />
            )}
          </div>
        );
      })}
    </>
  );
}

