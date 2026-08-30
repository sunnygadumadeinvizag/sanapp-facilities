"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fmtMin, fmtSlotRange } from "@/lib/ist";
import { Button } from "@/components/ui/button";

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
  onReject?: () => void;
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

  const bookedFragments = useMemo(
    () => bookings.flatMap((b) => fragments(b, days).map((f) => ({ ...f, label: b.label, id: b.id }))),
    [bookings, days]
  );

  /** True when a range conflicts with a booking or the past (NOT committed — those merge). */
  function conflict(range: RangeSelection): boolean {
    const inPast = idx(range.startDate, range.startMin) <= idx(todayKey, nowMin);
    if (inPast) return true;
    return bookings.some((b) => rangesOverlap(range, b));
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
    return bookings.some((b) => t >= idx(b.startDate, b.startMin) && t < idx(b.endDate, b.endMin));
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

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const cell = cellFromEvent(e);
    if (!cell || isDisabled(cell.date, cell.min)) return;
    
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
    if (conflict(range)) {
      onReject?.();
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

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm border-2 border-primary bg-primary/25" /> Tap or drag to select
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm border-2 border-primary bg-primary" /> Selected
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm bg-red-500/20 border border-red-400" /> Already booked
          </span>
        </p>
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-muted-foreground mr-1 hidden sm:inline">Zoom:</span>
          {ZOOMS.map((z) => (
            <Button
              key={z.key}
              type="button"
              variant={zoom.key === z.key ? "secondary" : "outline"}
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => setZoomKey(z.key)}
              title={`Zoom: ${z.label} marks`}
            >
              {z.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Live from–to tooltip while dragging */}
      {drag && dragPos && (
        <div
          className="pointer-events-none fixed z-50 rounded-md border bg-card px-3 py-1.5 text-xs font-semibold text-foreground shadow-xl"
          style={{ left: dragPos.x + 12, top: dragPos.y - 40 }}
        >
          {fmtSlotRange(drag.startDate, drag.startMin, drag.endDate, drag.endMin)}
        </div>
      )}

      <div ref={scrollerRef} className="overflow-auto rounded-lg border bg-card" style={{ maxHeight: maxHeight ?? "52vh" }}>
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
            {bookedFragments.map((f) => (
              <div
                key={f.id + f.date}
                className="fb-booked"
                style={{
                  left: days.indexOf(f.date) * colW + 2,
                  width: colW - 4,
                  top: (f.topMin / (24 * 60)) * colHeight + 1,
                  height: Math.max(14, ((f.bottomMin - f.topMin) / (24 * 60)) * colHeight - 2),
                }}
              >
                <span className="fb-booked-label">{f.label}</span>
              </div>
            ))}

            {/* Committed selection overlays */}
            {committed.map((r, i) => (
              <SelectionOverlay key={i} range={r} days={days} colW={colW} colHeight={colHeight} conflict={conflict(r)} solid />
            ))}

            {/* Current drag overlay */}
            {drag && <SelectionOverlay range={drag} days={days} colW={colW} colHeight={colHeight} conflict={conflict(drag)} />}
          </div>
        </div>
      </div>
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
}: {
  range: RangeSelection;
  days: string[];
  colW: number;
  colHeight: number;
  conflict: boolean;
  solid?: boolean;
}) {
  const frags = fragments(range, days);
  return (
    <>
      {frags.map((f) => (
        <div
          key={f.date}
          className="fb-selection flex items-center justify-start overflow-hidden px-1 text-primary-foreground font-semibold"
          style={{
            left: days.indexOf(f.date) * colW + 1,
            width: colW - 2,
            top: (f.topMin / (24 * 60)) * colHeight + 1,
            height: Math.max(14, ((f.bottomMin - f.topMin) / (24 * 60)) * colHeight - 2),
            ...(solid
              ? { borderColor: "var(--iipe-primary)", background: "color-mix(in srgb, var(--iipe-primary) 45%, transparent)" }
              : {}),
            ...(conflict
              ? { borderColor: "var(--iipe-danger)", background: "color-mix(in srgb, var(--iipe-danger) 22%, transparent)" }
              : {}),
          }}
        >
          <span className="text-[10px] leading-none px-1 py-0.5 rounded bg-primary text-white truncate max-w-full pointer-events-none">
            {fmtMin(f.topMin)}–{fmtMin(f.bottomMin)}
          </span>
        </div>
      ))}
    </>
  );
}

