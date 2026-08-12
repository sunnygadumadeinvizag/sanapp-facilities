"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fmtMin, fmtSlotRange } from "@/lib/ist";
import { Button } from "@/components/ui/button";

const CELL_MIN = 15;
const COL_W = 150; // px per day column
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
  { key: "15m", label: "15 min", cellH: 24, mark: 15 },
  { key: "1h", label: "1 h", cellH: 14, mark: 60 },
  { key: "2h", label: "2 h", cellH: 9, mark: 120 },
  { key: "6h", label: "6 h", cellH: 4.5, mark: 360 },
  { key: "1d", label: "1 d", cellH: 2.5, mark: 360 },
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
}) {
  const [zoomKey, setZoomKey] = useState("1h");
  const zoom = ZOOMS.find((z) => z.key === zoomKey) ?? ZOOMS[1];
  const colHeight = (24 * 60) / CELL_MIN * zoom.cellH;
  const [drag, setDrag] = useState<RangeSelection | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const dragFrom = useRef<{ date: string; min: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

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

  function cellFromEvent(e: React.PointerEvent): { date: string; min: number } | null {
    const el = containerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top - 0; // header is outside the grid container
    if (x < GUTTER_W) return null;
    const dayIdx = Math.floor((x - GUTTER_W) / COL_W);
    if (dayIdx < 0 || dayIdx >= days.length) return null;
    const min = Math.max(0, Math.min(24 * 60 - CELL_MIN, Math.floor(y / zoom.cellH) * CELL_MIN));
    return { date: days[dayIdx], min };
  }

  function isDisabled(date: string, min: number): boolean {
    if (date === todayKey && min < nowMin) return true;
    const t = idx(date, min);
    return bookings.some((b) => t >= idx(b.startDate, b.startMin) && t < idx(b.endDate, b.endMin));
  }

  /** Build the normalized range for a completed drag (end cell is inclusive). */
  function normalizeRange(
    a: { date: string; min: number },
    b: { date: string; min: number }
  ): RangeSelection | null {
    const ai = idx(a.date, a.min);
    const bi = idx(b.date, b.min);
    if (ai === bi) return null;
    const start = ai < bi ? a : b;
    const end = ai < bi ? b : a;
    const range: RangeSelection = {
      startDate: start.date,
      startMin: start.min,
      endDate: end.date,
      endMin: end.min + CELL_MIN, // include the whole end cell
    };
    if (idx(range.endDate, range.endMin) <= idx(range.startDate, range.startMin)) return null;
    return range;
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const cell = cellFromEvent(e);
    if (!cell || isDisabled(cell.date, cell.min)) return;
    dragFrom.current = cell;
    setDrag({ startDate: cell.date, startMin: cell.min, endDate: cell.date, endMin: cell.min + CELL_MIN });
    setDragPos({ x: e.clientX, y: e.clientY });
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* pointer capture is optional — drag still works via move events */
    }
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragFrom.current) return;
    setDragPos({ x: e.clientX, y: e.clientY });
    const cell = cellFromEvent(e);
    if (!cell) return;
    const ai = idx(dragFrom.current.date, dragFrom.current.min);
    const bi = idx(cell.date, cell.min);
    const start = ai <= bi ? dragFrom.current : cell;
    const end = ai <= bi ? cell : dragFrom.current;
    setDrag({
      startDate: start.date,
      startMin: start.min,
      endDate: end.date,
      endMin: end.min + CELL_MIN,
    });
  }

  function handlePointerUp() {
    if (!dragFrom.current) {
      setDrag(null);
      setDragPos(null);
      return;
    }
    const from = dragFrom.current;
    const cur = drag;
    dragFrom.current = null;
    setDrag(null);
    setDragPos(null);
    if (!cur) return;
    const range = normalizeRange(from, { date: cur.endDate, min: cur.endMin - CELL_MIN });
    if (!range) return;
    if (conflict(range)) {
      onReject?.();
      return;
    }

    // Extend: merge the drag with any committed range it touches or overlaps.
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

  const marks = Array.from({ length: 24 * 60 / CELL_MIN }, (_, i) => i * CELL_MIN).filter((m) => m % zoom.mark === 0);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 mr-3">
            <span className="inline-block h-3 w-3 rounded-sm border-2 border-primary bg-primary/25" /> Drag to select
          </span>
          <span className="inline-flex items-center gap-1.5 mr-3">
            <span className="inline-block h-3 w-3 rounded-sm border-2 border-primary bg-primary" /> Selected
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm bg-red-500/20 border border-red-400" /> Already booked
          </span>
        </p>
        <div className="flex items-center gap-1">
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
        {/* Day header (sticky) — today is bold but not background-highlighted */}
        <div className="sticky top-0 z-20 flex bg-card border-b">
          <div style={{ width: GUTTER_W }} className="shrink-0" />
          {days.map((d) => (
            <div
              key={d}
              style={{ width: COL_W }}
              className={`shrink-0 px-2 py-1.5 text-center border-r ${
                d === todayKey ? "text-primary font-bold" : "text-muted-foreground"
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
          <div style={{ width: GUTTER_W, height: colHeight }} className="shrink-0 relative">
            {marks.map((m) => (
              <div
                key={m}
                style={{ height: (CELL_MIN / (24 * 60)) * colHeight, top: (m / (24 * 60)) * colHeight }}
                className={`absolute right-1 -translate-y-1/2 text-muted-foreground ${
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
            className="relative flex"
            style={{ height: colHeight }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={() => {
              dragFrom.current = null;
              setDrag(null);
              setDragPos(null);
            }}
          >
            {days.map((d) => (
              <div key={d} className="shrink-0 relative border-r" style={{ width: COL_W, height: colHeight }}>
                {/* grid lines at the zoom's mark interval */}
                {marks.map((m) => (
                  <div
                    key={m}
                    className="absolute left-0 right-0 border-t"
                    style={{
                      top: (m / (24 * 60)) * colHeight,
                      borderColor: m % 60 === 0 ? "var(--iipe-border)" : "rgba(0,0,0,0.04)",
                    }}
                  />
                ))}
              </div>
            ))}

            {/* Booked overlays */}
            {bookedFragments.map((f) => (
              <div
                key={f.id + f.date}
                className="fb-booked"
                style={{
                  left: days.indexOf(f.date) * COL_W + 2,
                  width: COL_W - 4,
                  top: (f.topMin / (24 * 60)) * colHeight + 1,
                  height: Math.max(14, ((f.bottomMin - f.topMin) / (24 * 60)) * colHeight - 2),
                }}
              >
                <span className="fb-booked-label">{f.label}</span>
              </div>
            ))}

            {/* Committed selection overlays */}
            {committed.map((r, i) => (
              <SelectionOverlay key={i} range={r} days={days} colHeight={colHeight} conflict={conflict(r)} solid />
            ))}

            {/* Current drag overlay */}
            {drag && <SelectionOverlay range={drag} days={days} colHeight={colHeight} conflict={conflict(drag)} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function SelectionOverlay({
  range,
  days,
  colHeight,
  conflict,
  solid = false,
}: {
  range: RangeSelection;
  days: string[];
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
          className="fb-selection"
          style={{
            left: days.indexOf(f.date) * COL_W + 1,
            width: COL_W - 2,
            top: (f.topMin / (24 * 60)) * colHeight + 1,
            height: Math.max(12, ((f.bottomMin - f.topMin) / (24 * 60)) * colHeight - 2),
            ...(solid
              ? { borderColor: "var(--iipe-primary)", background: "color-mix(in srgb, var(--iipe-primary) 45%, transparent)" }
              : {}),
            ...(conflict
              ? { borderColor: "var(--iipe-danger)", background: "color-mix(in srgb, var(--iipe-danger) 22%, transparent)" }
              : {}),
          }}
        />
      ))}
    </>
  );
}
