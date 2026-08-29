"use client";
import { apiPath } from "sanapp-common-ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  Crosshair,
  Loader2,
  Paperclip,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TimeGrid, type BookingBlock, type FocusRequest, type RangeSelection } from "./TimeGrid";
import { DatePicker } from "./DatePicker";
import { effectiveMaxMinutes, capLabel } from "@/lib/limits";
import {
  PDF_MAX_BYTES,
  SLOT_MAX_MINUTES,
  addDays,
  fmtMin,
  fmtSlotRange,
  istDateKey,
  istMinute,
  istNow,
  mondayOf,
  slotDurationMin,
  slotIndex,
} from "@/lib/ist";

export type SlotItem = {
  id: string;
  startDate: string;
  endDate: string;
  startMin: number;
  endMin: number;
  bookerName: string;
  forName: string | null;
};

export type BookingMe = {
  name: string;
  primaryRole: string;
  role: string;
  /** POC of this facility or its building (or an app ADMIN). */
  isPocHere: boolean;
};

const WEEK_DAYS = 7;

/** A pending selection with a stable id (survives merges/edits without key churn). */
type PendingRange = { id: number; range: RangeSelection };

/** Absolute minute index of a wall-clock point (same math as slotIndex). */
function absMin(r: { startDate: string; startMin: number; endDate: string; endMin: number }): [number, number] {
  return [
    slotIndex(r.startDate, r.startMin),
    slotIndex(r.endDate, r.endMin),
  ];
}

/** Union of two ranges (min start, max end) — used when a drag/edit touches another range. */
function unionRange(a: RangeSelection, b: RangeSelection): RangeSelection {
  const [aS, aE] = absMin(a);
  const [bS, bE] = absMin(b);
  const s = new Date(Math.min(aS, bS) * 60000);
  const e = new Date(Math.max(aE, bE) * 60000);
  return {
    startDate: s.toISOString().slice(0, 10),
    startMin: s.getUTCHours() * 60 + s.getUTCMinutes(),
    endDate: e.toISOString().slice(0, 10),
    endMin: e.getUTCHours() * 60 + e.getUTCMinutes(),
  };
}

/** True when two ranges overlap or are exactly adjacent (share a boundary). */
function rangesTouch(a: RangeSelection, b: RangeSelection): boolean {
  const [aS, aE] = absMin(a);
  const [bS, bE] = absMin(b);
  return aS <= bE && aE >= bS;
}

/** Strict overlap — sharing a boundary (adjacent slots) is allowed. */
function rangesOverlapStrict(a: RangeSelection, b: RangeSelection): boolean {
  const [aS, aE] = absMin(a);
  const [bS, bE] = absMin(b);
  return aS < bE && aE > bS;
}

function parseTime(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

function dayShortName(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  return d.toLocaleDateString("en-IN", { weekday: "short" });
}

function fmtDateHeading(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

/** Details of a slot the server says was booked while the user was filling the form. */
export type ConflictInfo = {
  /** The range this user tried to book. */
  range: RangeSelection;
  /** Who holds the conflicting booking (booker or the user it is blocked for). */
  booker: string | null;
  /** The already-booked slot that collided. */
  date: string;
  endDate: string;
  startMin: number;
  endMin: number;
};

export type EditBookingInfo = {
  id: string;
  date: string;
  endDate: string;
  startMin: number;
  endMin: number;
  purpose: string | null;
  type: "SELF" | "ON_BEHALF" | "LONG";
  forUserId?: string | null;
  /** Name of the PDF currently attached to this booking (if any). */
  pdfName?: string | null;
};

export function BookingClient({
  facility,
  buildingName,
  today,
  todaySlots,
  me,
  eligible,
  nowMin = 0,
  maxMinutes = null,
  buildingMaxMinutes = null,
  roleLimits = [],
  editBooking = null,
  onEdited,
}: {
  facility: { id: string; name: string };
  buildingName: string;
  today: string;
  todaySlots: SlotItem[];
  me: BookingMe;
  eligible: boolean;
  nowMin?: number;
  maxMinutes?: number | null;
  buildingMaxMinutes?: number | null;
  roleLimits?: { role: string; maxMinutes: number }[];
  editBooking?: EditBookingInfo | null;
  onEdited?: () => void;
}) {
  const router = useRouter();
  const canPoc = me.isPocHere || me.role === "ADMIN";
  const isAdmin = me.role === "ADMIN";

  // Live IST clock: keeps the past-time shading and the conflict checks fresh
  // while the page stays open (server-provided today/nowMin go stale).
  const [clock, setClock] = useState<{ today: string; nowMin: number }>({ today, nowMin });
  useEffect(() => {
    const tick = () => {
      const n = istNow();
      setClock({ today: istDateKey(n), nowMin: istMinute(n) });
    };
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, []);

  const effMax = useMemo(
    () => effectiveMaxMinutes({ maxMinutes }, roleLimits, me.primaryRole, buildingMaxMinutes),
    [maxMinutes, buildingMaxMinutes, roleLimits, me.primaryRole]
  );
  const effMaxLabel = capLabel(effMax);

  // Active day and view mode (Day / 3-Day / Week) for easy mobile navigation
  const [activeDay, setActiveDay] = useState(() => editBooking?.date ?? today);
  const [weekStart, setWeekStart] = useState(() => mondayOf(activeDay));
  const [viewMode, setViewMode] = useState<"day" | "3day" | "week">("week");
  const [showQuickAdd, setShowQuickAdd] = useState(false);

  // Auto-switch to Day view on mobile screens on initial load
  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setViewMode("day");
    }
  }, []);

  const [bookings, setBookings] = useState<BookingBlock[]>([]);
  const [loading, setLoading] = useState(false);
  const [ranges, setRanges] = useState<PendingRange[]>(() =>
    editBooking
      ? [
          {
            id: 0,
            range: {
              startDate: editBooking.date,
              startMin: editBooking.startMin,
              endDate: editBooking.endDate || editBooking.date,
              endMin: editBooking.endMin,
            },
          },
        ]
      : []
  );
  const idRef = useRef(editBooking ? 1 : 0);
  // Mirror of `ranges` so event handlers can validate against the current
  // selection synchronously (state updates are async).
  const rangesRef = useRef<PendingRange[]>(ranges);
  function applyRanges(next: PendingRange[]) {
    rangesRef.current = next;
    setRanges(next);
  }
  const [focusReq, setFocusReq] = useState<FocusRequest | null>(null);
  const focusNonce = useRef(0);
  const [rejectMsg, setRejectMsg] = useState<string | null>(null);
  const [forOther, setForOther] = useState(editBooking ? editBooking.type === "ON_BEHALF" : false);
  const [forQuery, setForQuery] = useState("");
  const [forResults, setForResults] = useState<{ id: string; username: string; name: string }[]>([]);
  const [forUserId, setForUserId] = useState(editBooking?.forUserId ?? "");
  const [purpose, setPurpose] = useState(editBooking?.purpose ?? "");
  const [pdfName, setPdfName] = useState("");
  const [pdf, setPdf] = useState<File | null>(null);
  const [pdfClear, setPdfClear] = useState(false);
  const existingPdfName = editBooking?.pdfName ?? null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const rejectTimer = useRef<number | null>(null);
  // Set when the server rejects a slot because someone else booked it while
  // this user was completing the form (the classic two-user race).
  const [conflictModal, setConflictModal] = useState<ConflictInfo | null>(null);

  // Week days for the current weekStart
  const weekDays = useMemo(
    () => Array.from({ length: WEEK_DAYS }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  // Days currently visible on the TimeGrid based on viewMode
  const displayedDays = useMemo(() => {
    if (viewMode === "day") {
      return [activeDay];
    }
    if (viewMode === "3day") {
      return [activeDay, addDays(activeDay, 1), addDays(activeDay, 2)];
    }
    return weekDays;
  }, [viewMode, activeDay, weekDays]);

  const loadBookings = useCallback(
    async (start: string) => {
      const end = addDays(start, WEEK_DAYS - 1);
      try {
        setLoading(true);
        const res = await fetch(apiPath(`/api/bookings?facilityId=${facility.id}&from=${start}&to=${end}`), {
          cache: "no-store",
        });
        if (res.ok) {
          const data = await res.json();
          setBookings(
            (data.bookings ?? []).map((b: any) => ({
              id: b.id,
              startDate: b.date,
              endDate: b.endDate || b.date,
              startMin: b.startMin,
              endMin: b.endMin,
              label: `${fmtMin(b.startMin)}–${fmtMin(b.endMin)} · ${b.forUser?.name ?? b.user?.name ?? ""}`,
            }))
          );
        }
      } catch {
        /* keep current */
      } finally {
        setLoading(false);
      }
    },
    [facility.id]
  );

  useEffect(() => {
    void loadBookings(weekStart);
  }, [weekStart, loadBookings]);

  async function searchUsers(q: string) {
    if (!q.trim()) {
      setForResults([]);
      return;
    }
    try {
      const res = await fetch(apiPath(`/api/users?kind=sso&q=${encodeURIComponent(q)}`));
      if (res.ok) {
        const data = await res.json();
        setForResults(data.users ?? []);
      }
    } catch {
      setForResults([]);
    }
  }

  function pickFile(f: File | null) {
    if (!f) {
      setPdf(null);
      setPdfName("");
      setPdfClear(false);
      return;
    }
    if (!f.name.toLowerCase().endsWith(".pdf")) {
      setError("Attachment must be a PDF file");
      return;
    }
    if (f.size > PDF_MAX_BYTES) {
      setError("PDF attachment must be 1 MB or smaller");
      return;
    }
    setError(null);
    setPdf(f);
    setPdfName(f.name);
    setPdfClear(false);
  }

  /**
   * Auto-commit a selected/dragged range (called by TimeGrid on pointer release or tap).
   */
  function commitRange(range: RangeSelection, mergeIndices?: number[]) {
    const prev = rangesRef.current;
    // In edit mode there is exactly one range — a new selection replaces it.
    if (editBooking) {
      applyRanges([{ id: prev[0]?.id ?? ++idRef.current, range }]);
      return;
    }
    if (mergeIndices && mergeIndices.length > 0) {
      const keep = prev.filter((_, i) => !mergeIndices.includes(i));
      const id = prev[mergeIndices[0]]?.id ?? ++idRef.current;
      applyRanges([{ id, range }, ...keep]);
      return;
    }
    // A new slot may not overlap a slot already picked for this booking —
    // otherwise one booking would claim the same time twice.
    if (prev.some((p) => rangesOverlapStrict(p.range, range))) {
      rejectRange("That time is already part of this booking — remove or edit the selected slot first.");
      return;
    }
    applyRanges([...prev, { id: ++idRef.current, range }]);
  }

  function rejectRange(msg?: string) {
    setRejectMsg(
      msg ??
        "That range overlaps an already-booked slot or the past — nothing was added."
    );
    if (rejectTimer.current) window.clearTimeout(rejectTimer.current);
    rejectTimer.current = window.setTimeout(() => setRejectMsg(null), 4000);
  }

  function removeRange(id: number) {
    applyRanges(rangesRef.current.filter((p) => p.id !== id));
  }

  /** Validate and apply a From/To edit; merges any other selection it now touches. */
  function updateRange(id: number, next: RangeSelection): string | null {
    const dur = slotDurationMin(next.startDate, next.startMin, next.endDate, next.endMin);
    if (dur < 15) return "End must be at least 15 minutes after start.";
    if (slotIndex(next.startDate, next.startMin) <= slotIndex(clock.today, clock.nowMin)) {
      return "Start must be in the future.";
    }
    const overlapsBooking = bookings.some((b) => {
      const [s, e] = absMin(next);
      return s < slotIndex(b.endDate, b.endMin) && e > slotIndex(b.startDate, b.startMin);
    });
    if (overlapsBooking) return "That range overlaps an already-booked slot.";
    // May not overlap another slot picked for this same booking.
    if (rangesRef.current.some((p) => p.id !== id && rangesOverlapStrict(p.range, next))) {
      return "That range overlaps another slot selected in this booking.";
    }
    let merged = next;
    const absorbed = new Set<number>();
    for (const p of rangesRef.current) {
      if (p.id === id) continue;
      if (rangesTouch(merged, p.range)) {
        merged = unionRange(merged, p.range);
        absorbed.add(p.id);
      }
    }
    applyRanges([{ id, range: merged }, ...rangesRef.current.filter((p) => p.id !== id && !absorbed.has(p.id))]);
    return null;
  }

  const anyLong = ranges.some((p) => {
    const dur = slotDurationMin(p.range.startDate, p.range.startMin, p.range.endDate, p.range.endMin);
    return effMax !== null ? dur > effMax : false;
  });
  const isOnBehalf = forOther;
  const needPurpose = anyLong || isOnBehalf;

  function overCap(r: RangeSelection): boolean {
    if (isAdmin || effMax === null) return false;
    return slotDurationMin(r.startDate, r.startMin, r.endDate, r.endMin) > effMax;
  }
  const hasOverCap = ranges.some((p) => overCap(p.range));

  // Navigation helpers for Previous / Next / Today
  function handlePrev() {
    if (viewMode === "day") {
      const prev = addDays(activeDay, -1);
      setActiveDay(prev);
      setWeekStart(mondayOf(prev));
    } else if (viewMode === "3day") {
      const prev = addDays(activeDay, -3);
      setActiveDay(prev);
      setWeekStart(mondayOf(prev));
    } else {
      const prevWeek = addDays(weekStart, -WEEK_DAYS);
      setWeekStart(prevWeek);
      setActiveDay(prevWeek);
    }
  }

  function handleNext() {
    if (viewMode === "day") {
      const next = addDays(activeDay, 1);
      setActiveDay(next);
      setWeekStart(mondayOf(next));
    } else if (viewMode === "3day") {
      const next = addDays(activeDay, 3);
      setActiveDay(next);
      setWeekStart(mondayOf(next));
    } else {
      const nextWeek = addDays(weekStart, WEEK_DAYS);
      setWeekStart(nextWeek);
      setActiveDay(nextWeek);
    }
  }

  function handleToday() {
    setActiveDay(clock.today);
    setWeekStart(mondayOf(clock.today));
  }

  function selectDayPill(d: string) {
    setActiveDay(d);
    setWeekStart(mondayOf(d));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (ranges.length === 0) return;
    setBusy(true);
    setError(null);
    setSuccess(null);

    // Edit mode: PATCH the single existing booking.
    if (editBooking) {
      const { range } = ranges[0];
      try {
        const wantPdfChange = pdf !== null || pdfClear;
        const payload = wantPdfChange ? new FormData() : null;
        if (payload) {
          payload.set("id", editBooking.id);
          payload.set("startDate", range.startDate);
          payload.set("endDate", range.endDate);
          payload.set("startMin", String(range.startMin));
          payload.set("endMin", String(range.endMin));
          if (purpose.trim()) payload.set("purpose", purpose.trim());
          if (pdfClear && !pdf) payload.set("pdfClear", "1");
          if (pdf) payload.set("pdf", pdf, pdf.name);
        }
        const res = await fetch(apiPath("/api/bookings"), {
          method: "PATCH",
          ...(payload
            ? { body: payload }
            : {
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  id: editBooking.id,
                  startDate: range.startDate,
                  endDate: range.endDate,
                  startMin: range.startMin,
                  endMin: range.endMin,
                  purpose: purpose.trim() || null,
                }),
              }),
        });
        const data = await res.json();
        if (!res.ok) {
          // Someone booked the slot while this user was editing — show the
          // "booked just now" modal instead of a bare inline error.
          if (res.status === 409 && data.conflict) {
            setConflictModal({
              range,
              booker: data.conflict.booker ?? null,
              date: data.conflict.date ?? range.startDate,
              endDate: data.conflict.endDate ?? range.endDate,
              startMin: data.conflict.startMin ?? range.startMin,
              endMin: data.conflict.endMin ?? range.endMin,
            });
            await loadBookings(weekStart);
            setBusy(false);
            return;
          }
          throw new Error(data.error ?? "Could not update the booking");
        }
        setSuccess("Booking updated.");
        setBusy(false);
        onEdited?.();
        window.setTimeout(() => router.push("/my-bookings"), 800);
        return;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not update the booking");
        setBusy(false);
        return;
      }
    }

    const batchId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
    const created: string[] = [];
    const failed: string[] = [];
    let conflictHit: ConflictInfo | null = null;
    for (let i = 0; i < ranges.length; i++) {
      const { range } = ranges[i];
      const form = new FormData();
      form.set("facilityId", facility.id);
      form.set("batchId", batchId);
      form.set("startDate", range.startDate);
      form.set("endDate", range.endDate);
      form.set("startMin", String(range.startMin));
      form.set("endMin", String(range.endMin));
      if (purpose.trim()) form.set("purpose", purpose.trim());
      if (isOnBehalf && forUserId) form.set("forUserId", forUserId);
      if (pdf) form.set("pdf", pdf, pdf.name);
      try {
        const res = await fetch(apiPath("/api/bookings"), { method: "POST", body: form });
        const data = await res.json();
        if (res.ok) {
          created.push(data.booking?.id ?? "");
          continue;
        }
        if (res.status === 409) {
          // Lost the race: someone booked this slot while the form was open.
          conflictHit = {
            range,
            booker: data.conflict?.booker ?? null,
            date: data.conflict?.date ?? range.startDate,
            endDate: data.conflict?.endDate ?? range.endDate,
            startMin: data.conflict?.startMin ?? range.startMin,
            endMin: data.conflict?.endMin ?? range.endMin,
          };
          // Keep the conflicting slot plus the not-yet-tried ones so the user
          // can refresh availability and retry; already-booked ones are dropped.
          applyRanges(ranges.slice(i));
          break;
        }
        failed.push(data.error ?? "Could not create the booking");
      } catch {
        failed.push("Network error while creating a booking");
      }
    }

    if (conflictHit) {
      setConflictModal(conflictHit);
      await loadBookings(weekStart);
      setBusy(false);
      return;
    }

    if (created.length > 0) {
      setSuccess(
        `${created.length} booking${created.length === 1 ? "" : "s"} confirmed${
          failed.length > 0 ? ` — ${failed.length} failed` : ""
        }.`
      );
    }
    if (failed.length > 0 && created.length === 0) {
      setError(failed.join(" · "));
    }
    setPurpose("");
    setPdf(null);
    setPdfName("");
    setPdfClear(false);
    setForUserId("");
    setForQuery("");
    setForResults([]);
    applyRanges([]);
    await loadBookings(weekStart);
    setBusy(false);
  }

  return (
    <div>
      {/* Day's schedule chips */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="gap-1 font-medium">
          <span>Today: {clock.today}</span>
        </Badge>
        {todaySlots.length > 0 ? (
          todaySlots.map((s) => (
            <Badge
              key={s.id}
              variant="outline"
              className="gap-1 text-red-700 border-red-300 bg-red-50"
              title={s.forName ? `Blocked for ${s.forName}` : undefined}
            >
              {fmtMin(s.startMin)}–{fmtMin(s.endMin)} IST · {s.forName ?? s.bookerName}
            </Badge>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">No bookings today</span>
        )}
      </div>

      {!eligible && (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          This facility is restricted to specific primary roles. Your role ({me.primaryRole || "not set"}) is not
          in the allowed list.
          {canPoc ? " As the POC of this facility you can still block a slot for an eligible user." : ""}
        </div>
      )}

      <div className="mt-4 space-y-4">
        <Card className="shadow-sm">
          <CardContent className="p-3 sm:p-4 space-y-3">
            {/* Calendar Controls Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
              {/* Previous / Next / Today */}
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={handlePrev} title="Previous">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleNext} title="Next">
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={handleToday}>
                  Today
                </Button>
              </div>

              {/* Current Date / Range Display */}
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground text-center">
                {viewMode === "day" && <span>{fmtDateHeading(activeDay)}</span>}
                {viewMode === "3day" && (
                  <span>
                    {fmtDateHeading(activeDay).split(",")[1]?.trim() ?? activeDay} —{" "}
                    {fmtDateHeading(addDays(activeDay, 2)).split(",")[1]?.trim() ?? addDays(activeDay, 2)}
                  </span>
                )}
                {viewMode === "week" && (
                  <span>
                    {weekDays[0]} — {weekDays[weekDays.length - 1]}
                  </span>
                )}
                {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              </div>

              {/* View Mode Switcher + Quick Add Button */}
              <div className="flex items-center gap-2 ml-auto">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs text-primary border-primary/40 hover:bg-primary/5"
                  onClick={() => setShowQuickAdd(true)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  <Clock className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Add by time</span>
                </Button>

                <div className="flex items-center rounded-lg border bg-muted/50 p-0.5 text-xs">
                  <Button
                    type="button"
                    variant={viewMode === "day" ? "secondary" : "ghost"}
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setViewMode("day")}
                  >
                    1 Day
                  </Button>
                  <Button
                    type="button"
                    variant={viewMode === "3day" ? "secondary" : "ghost"}
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setViewMode("3day")}
                  >
                    3 Days
                  </Button>
                  <Button
                    type="button"
                    variant={viewMode === "week" ? "secondary" : "ghost"}
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setViewMode("week")}
                  >
                    Week
                  </Button>
                </div>
              </div>
            </div>

            {/* Day Selector Pills Bar (Always accessible, great for mobile!) */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
              {weekDays.map((d) => {
                const isCurrentActive =
                  viewMode === "day"
                    ? d === activeDay
                    : viewMode === "3day"
                    ? d >= activeDay && d <= addDays(activeDay, 2)
                    : false;
                const isToday = d === clock.today;
                const bookedCount = bookings.filter((b) => b.startDate <= d && b.endDate >= d).length;
                const hasSelected = ranges.some((r) => r.range.startDate <= d && r.range.endDate >= d);

                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => selectDayPill(d)}
                    className={`flex-1 min-w-[58px] sm:min-w-[70px] py-1.5 px-2 rounded-lg border text-center transition-all flex flex-col items-center justify-center gap-0.5 ${
                      isCurrentActive
                        ? "bg-primary text-primary-foreground border-primary shadow-sm ring-2 ring-primary/20 font-bold"
                        : "bg-card hover:bg-muted/70 text-foreground border-border"
                    }`}
                  >
                    <span className="text-[10px] uppercase tracking-wider font-semibold opacity-90">
                      {dayShortName(d)}
                    </span>
                    <span className="text-xs font-bold leading-none">
                      {d.slice(8)}
                    </span>
                    <div className="flex items-center gap-1 mt-0.5">
                      {isToday && (
                        <span
                          className={`inline-block h-1.5 w-1.5 rounded-full ${
                            isCurrentActive ? "bg-white" : "bg-primary"
                          }`}
                          title="Today"
                        />
                      )}
                      {hasSelected && (
                        <span
                          className={`inline-block h-1.5 w-1.5 rounded-full ${
                            isCurrentActive ? "bg-amber-300" : "bg-primary"
                          }`}
                          title="Selected slot on this day"
                        />
                      )}
                      {bookedCount > 0 && (
                        <span
                          className={`inline-block h-1.5 w-1.5 rounded-full ${
                            isCurrentActive ? "bg-red-300" : "bg-red-500"
                          }`}
                          title={`${bookedCount} booked slot(s)`}
                        />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            {rejectMsg && (
              <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                {rejectMsg}
              </div>
            )}

            <TimeGrid
              days={displayedDays}
              bookings={bookings}
              committed={ranges.map((p) => p.range)}
              onCommit={commitRange}
              onReject={rejectRange}
              nowMin={clock.nowMin}
              todayKey={clock.today}
              maxHeight="58vh"
              onAutoAdvance={(delta) => {
                const nextWeek = addDays(weekStart, delta);
                setWeekStart(nextWeek);
                setActiveDay(nextWeek);
              }}
              focus={focusReq}
            />

            <p className="text-[11px] text-muted-foreground">
              Tip: Tap any slot cell to select it. Tap adjacent slots to extend, or drag across hours.
              On mobile phones, switch to <strong>1 Day</strong> view for full-width time slots.
            </p>
          </CardContent>
        </Card>

        {/* Selected slots summary */}
        {ranges.length > 0 && (
          <Card className="shadow-sm">
            <CardContent className="p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-semibold">Selected slots ({ranges.length})</h4>
                  {hasOverCap && (
                    <span className="text-xs text-red-600 font-medium">Some slots exceed the {effMaxLabel} limit</span>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                  onClick={() => applyRanges([])}
                >
                  Clear all
                </Button>
              </div>
              <div className="flex flex-col gap-2">
                {ranges.map(({ id, range }) => {
                  const dur = slotDurationMin(range.startDate, range.startMin, range.endDate, range.endMin);
                  const long = effMax !== null ? dur > effMax : false;
                  const cap = overCap(range);
                  return (
                    <RangeRow
                      key={id}
                      range={range}
                      dur={dur}
                      long={long}
                      cap={cap}
                      effMaxLabel={effMaxLabel}
                      forOther={forOther}
                      onRemove={() => removeRange(id)}
                      onSave={(next) => updateRange(id, next)}
                      onLocate={() => {
                        setActiveDay(range.startDate);
                        setWeekStart(mondayOf(range.startDate));
                        setFocusReq({ range, nonce: ++focusNonce.current });
                      }}
                    />
                  );
                })}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Click the pencil icon on any slot to fine-tune From / To times, or the crosshair to scroll to it on the calendar.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Booking details */}
        <Card className="shadow-sm">
          <CardContent className="p-4 space-y-4">
            {!editBooking && canPoc && (
              <label className="flex items-center gap-2 text-sm font-medium">
                <Checkbox checked={forOther} onCheckedChange={(v) => setForOther(v === true)} />
                Block these slots for another user
              </label>
            )}

            {forOther && (
              <div className="max-w-md">
                <Label>Book for (search name or username)</Label>
                <Input
                  value={forQuery}
                  placeholder="e.g. sanyasi or Sanyasi Naidu"
                  className="mt-1"
                  onChange={(e) => {
                    setForQuery(e.target.value);
                    setForUserId("");
                    void searchUsers(e.target.value);
                  }}
                />
                {forResults.length > 0 && (
                  <div className="mt-2 flex flex-col gap-1 max-h-48 overflow-y-auto rounded-md border p-1 bg-card shadow-sm">
                    {forResults.map((u) => (
                      <Button
                        key={u.id}
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="justify-start text-xs"
                        onClick={() => {
                          setForUserId(u.id);
                          setForQuery(`${u.name} (@${u.username})`);
                          setForResults([]);
                        }}
                      >
                        {u.name} (@{u.username})
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor={`purpose-${facility.id}`}>
                  Description {needPurpose ? "(required)" : "(optional)"}
                </Label>
                <Textarea
                  id={`purpose-${facility.id}`}
                  rows={3}
                  className="mt-1"
                  placeholder={needPurpose ? "Describe the purpose of these bookings" : "Optional — e.g. weekly staff meeting"}
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                />
              </div>
              <div>
                <Label>Attachment (PDF, max 1 MB)</Label>
                <Input
                  type="file"
                  accept="application/pdf,.pdf"
                  className="mt-1"
                  onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  {editBooking ? "Optional" : "Optional — applies to all slots in this booking"}
                </p>
                <div className="flex flex-wrap items-center gap-2 mt-1.5">
                  {pdfName && (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground font-medium">
                      <Paperclip className="h-3 w-3" /> {pdfName}
                    </span>
                  )}
                  {!pdfName && existingPdfName && editBooking && (
                    <span className="inline-flex items-center gap-2 text-xs">
                      <a
                        href={apiPath("/api/bookings/" + editBooking.id + "/pdf")}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
                      >
                        <Paperclip className="h-3 w-3" /> {existingPdfName}
                      </a>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-1.5 text-[11px] text-red-600 hover:text-red-700"
                        onClick={() => {
                          setPdfClear(true);
                          setPdf(null);
                          setPdfName("");
                        }}
                      >
                        Remove
                      </Button>
                    </span>
                  )}
                  {pdfClear && !pdfName && (
                    <span className="text-xs font-medium text-red-600">
                      Current attachment will be removed when you save.
                    </span>
                  )}
                </div>
              </div>
            </div>

            {error && (
              <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
            )}
            {success && (
              <div className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700">
                {success}
              </div>
            )}

            <Button
              type="submit"
              className="w-full sm:w-auto sm:min-w-[240px]"
              onClick={submit}
              disabled={
                busy ||
                ranges.length === 0 ||
                hasOverCap ||
                (forOther && !forUserId) ||
                (needPurpose && !purpose.trim()) ||
                (anyLong && !canPoc)
              }
            >
              {busy ? "Saving…" : editBooking ? "Save changes" : `Confirm ${ranges.length > 1 ? `${ranges.length} slots` : "booking"}`}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Quick Add Slot Modal */}
      <QuickAddSlotDialog
        open={showQuickAdd}
        onOpenChange={setShowQuickAdd}
        initialDate={activeDay}
        todayKey={clock.today}
        nowMin={clock.nowMin}
        bookings={bookings}
        pendingRanges={rangesRef.current.map((p) => p.range)}
        onAddSlot={(range) => {
          commitRange(range);
          setActiveDay(range.startDate);
          setWeekStart(mondayOf(range.startDate));
        }}
      />

      {/* "Booked just now" race-conflict modal */}
      <Dialog open={conflictModal !== null} onOpenChange={(o) => { if (!o) setConflictModal(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              Slot booked just now
            </DialogTitle>
            <DialogDescription>
              Someone else booked this slot while you were completing your booking.
            </DialogDescription>
          </DialogHeader>
          {conflictModal && (
            <div className="space-y-2 py-1 text-sm">
              <p>
                The slot{" "}
                <span className="font-semibold">
                  {fmtSlotRange(conflictModal.range.startDate, conflictModal.range.startMin, conflictModal.range.endDate, conflictModal.range.endMin)}
                </span>{" "}
                is no longer available.
              </p>
              {conflictModal.booker && (
                <p>
                  It was booked just now by{" "}
                  <span className="font-semibold">{conflictModal.booker}</span>{" "}
                  ({fmtSlotRange(conflictModal.date, conflictModal.startMin, conflictModal.endDate, conflictModal.endMin)}).
                </p>
              )}
              <p className="text-muted-foreground">
                Please refresh to get the latest slot availability, then pick a free slot.
              </p>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setConflictModal(null)}>
              Close
            </Button>
            <Button
              type="button"
              onClick={async () => {
                setConflictModal(null);
                await loadBookings(weekStart);
              }}
            >
              Refresh availability
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** One row of the "Selected ranges" list — shows the range, and an inline From/To editor. */
function RangeRow({
  range,
  dur,
  long,
  cap,
  effMaxLabel,
  forOther,
  onRemove,
  onSave,
  onLocate,
}: {
  range: RangeSelection;
  dur: number;
  long: boolean;
  cap: boolean;
  effMaxLabel: string;
  forOther: boolean;
  onRemove: () => void;
  onSave: (next: RangeSelection) => string | null;
  onLocate: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [startDate, setStartDate] = useState(range.startDate);
  const [startTime, setStartTime] = useState(fmtMin(range.startMin));
  const [endDate, setEndDate] = useState(range.endDate);
  const [endTime, setEndTime] = useState(fmtMin(range.endMin));
  const [err, setErr] = useState<string | null>(null);

  // Keep local fields in sync if the parent replaces the range (e.g. merge).
  useEffect(() => {
    setStartDate(range.startDate);
    setStartTime(fmtMin(range.startMin));
    setEndDate(range.endDate);
    setEndTime(fmtMin(range.endMin));
  }, [range]);

  function save() {
    const sT = parseTime(startTime);
    const eT = parseTime(endTime);
    if (sT == null || eT == null) {
      setErr("Enter valid times in HH:MM format.");
      return;
    }
    const msg = onSave({ startDate, startMin: sT, endDate, endMin: eT });
    if (msg) {
      setErr(msg);
      return;
    }
    setErr(null);
    setEditing(false);
  }

  return (
    <div
      className={`rounded-md border px-3 py-2 ${
        cap ? "border-red-300 bg-red-50" : "border-border bg-muted/30"
      }`}
    >
      {editing ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div>
              <Label className="text-[10px] uppercase text-muted-foreground">From date</Label>
              <DatePicker value={startDate} onChange={setStartDate} className="w-full mt-1" />
            </div>
            <div>
              <Label className="text-[10px] uppercase text-muted-foreground">From time (IST)</Label>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="h-8 text-xs mt-1" />
            </div>
            <div>
              <Label className="text-[10px] uppercase text-muted-foreground">To date</Label>
              <DatePicker value={endDate} onChange={setEndDate} className="w-full mt-1" />
            </div>
            <div>
              <Label className="text-[10px] uppercase text-muted-foreground">To time (IST)</Label>
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="h-8 text-xs mt-1" />
            </div>
          </div>
          {err && <p className="text-xs text-red-600">{err}</p>}
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" onClick={save}>
              Save
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => { setErr(null); setEditing(false); }}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={long ? "destructive" : cap ? "outline" : "default"}>
            {fmtSlotRange(range.startDate, range.startMin, range.endDate, range.endMin)}
          </Badge>
          <span className="text-xs text-muted-foreground font-medium">
            {dur < 60 ? `${dur} min` : `${(dur / 60).toFixed(dur % 60 ? 1 : 0)} h`}
          </span>
          <Badge variant="secondary">
            {long ? "Long (POC)" : forOther ? "On-behalf block" : "Self"}
          </Badge>
          {cap && <span className="text-xs text-red-600 font-semibold">over {effMaxLabel} limit</span>}
          <span className="ml-auto flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              title="Show this slot on the calendar"
              onClick={onLocate}
            >
              <Crosshair className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              title="Edit From / To"
              onClick={() => setEditing(true)}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-red-600 hover:text-red-700 hover:bg-red-50"
              onClick={onRemove}
              title="Remove this slot"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </span>
        </div>
      )}
    </div>
  );
}

/** Quick Modal to select a slot by Date range, Start Time, and Duration / End Time */
function QuickAddSlotDialog({
  open,
  onOpenChange,
  initialDate,
  todayKey,
  nowMin,
  bookings,
  pendingRanges,
  onAddSlot,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialDate: string;
  todayKey: string;
  nowMin: number;
  bookings: BookingBlock[];
  /** Slots already picked for this booking — a new slot may not overlap them. */
  pendingRanges: RangeSelection[];
  onAddSlot: (range: RangeSelection) => void;
}) {
  const [date, setDate] = useState(initialDate);
  const [endDate, setEndDate] = useState(initialDate);
  const [startTime, setStartTime] = useState("10:00");
  const [durationMin, setDurationMin] = useState(60);
  const [customEndTime, setCustomEndTime] = useState("11:00");
  const [useCustomEnd, setUseCustomEnd] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDate(initialDate);
      setEndDate(initialDate);
      setErr(null);
    }
  }, [open, initialDate]);

  // When a duration preset is active, keep the displayed To date / end time in
  // sync (this also carries the end across midnight onto the next day).
  useEffect(() => {
    if (useCustomEnd) return;
    const s = parseTime(startTime);
    if (s === null) return;
    const endAbs = slotIndex(date, s) + durationMin;
    setEndDate(new Date(endAbs * 60000).toISOString().slice(0, 10));
    setCustomEndTime(fmtMin(endAbs % 1440));
  }, [startTime, durationMin, date, useCustomEnd]);

  function handleAdd() {
    const sMin = parseTime(startTime);
    if (sMin === null) {
      setErr("Please enter a valid start time (HH:MM).");
      return;
    }
    let endDt = endDate;
    let eMin: number | null;
    if (useCustomEnd) {
      eMin = parseTime(customEndTime);
      if (eMin === null) {
        setErr("Please enter a valid end time (HH:MM).");
        return;
      }
    } else {
      const endAbs = slotIndex(date, sMin) + durationMin;
      endDt = new Date(endAbs * 60000).toISOString().slice(0, 10);
      eMin = endAbs % 1440;
    }
    if (endDt < date) {
      setErr("End date cannot be before the start date.");
      return;
    }
    const startAbs = slotIndex(date, sMin);
    const endAbs = slotIndex(endDt, eMin ?? 0);
    if (endAbs <= startAbs) {
      setErr("End must be after the start.");
      return;
    }
    if (startAbs <= slotIndex(todayKey, nowMin)) {
      setErr("Selected start time must be in the future.");
      return;
    }
    const range: RangeSelection = {
      startDate: date,
      startMin: sMin,
      endDate: endDt,
      endMin: eMin ?? 0,
    };
    // Conflict checks: already-booked slots on the server…
    const [s, e] = absMin(range);
    const overlapsBooked = bookings.some((b) => {
      return s < slotIndex(b.endDate, b.endMin) && e > slotIndex(b.startDate, b.startMin);
    });
    if (overlapsBooked) {
      setErr("That time slot overlaps an already-booked slot.");
      return;
    }
    // …and slots already picked for this same booking.
    if (pendingRanges.some((p) => rangesOverlapStrict(p, range))) {
      setErr("That time slot overlaps one you already selected for this booking.");
      return;
    }
    setErr(null);
    onAddSlot(range);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            Quick Add Slot
          </DialogTitle>
          <DialogDescription>
            Select a date range, start time, and duration to add a slot to your booking.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs font-semibold">From date</Label>
              <div className="mt-1">
                <DatePicker
                  value={date}
                  onChange={(d) => {
                    setDate(d);
                    if (endDate < d) setEndDate(d);
                  }}
                  className="w-full"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs font-semibold">To date</Label>
              <div className="mt-1">
                <DatePicker
                  value={endDate}
                  onChange={setEndDate}
                  className="w-full"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs font-semibold">Start Time (IST)</Label>
              <Input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs font-semibold">End Time (IST)</Label>
              <Input
                type="time"
                value={customEndTime}
                disabled={!useCustomEnd}
                onChange={(e) => {
                  setCustomEndTime(e.target.value);
                  setUseCustomEnd(true);
                }}
                className={`mt-1 ${!useCustomEnd ? "bg-muted text-muted-foreground" : ""}`}
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label className="text-xs font-semibold">Quick Duration</Label>
              <button
                type="button"
                onClick={() => setUseCustomEnd(!useCustomEnd)}
                className="text-[11px] text-primary hover:underline"
              >
                {useCustomEnd ? "Use presets" : "Custom end time"}
              </button>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {[
                { label: "15 min", min: 15 },
                { label: "30 min", min: 30 },
                { label: "1 hour", min: 60 },
                { label: "2 hours", min: 120 },
              ].map((d) => (
                <Button
                  key={d.min}
                  type="button"
                  size="sm"
                  variant={!useCustomEnd && durationMin === d.min ? "default" : "outline"}
                  className="h-8 text-xs px-1"
                  onClick={() => {
                    setDurationMin(d.min);
                    setUseCustomEnd(false);
                  }}
                >
                  {d.label}
                </Button>
              ))}
            </div>
          </div>

          {err && (
            <div className="rounded-md border border-red-300 bg-red-50 p-2.5 text-xs text-red-700">
              {err}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleAdd}>
            Add Slot
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
