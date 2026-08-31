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
  Headphones,
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
import { primaryRoleLabel } from "@/lib/labels";
import {
  PDF_MAX_BYTES,
  SLOT_MAX_MINUTES,
  addDays,
  fmtDuration,
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
  bookerUsername?: string;
  bookerPrimaryRole?: string | null;
  forName: string | null;
  forUsername?: string | null;
  forPrimaryRole?: string | null;
  needAvSupport?: boolean;
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
  isPublicPurpose?: boolean;
  type: "SELF" | "ON_BEHALF" | "LONG";
  forUserId?: string | null;
  /** Name of the PDF currently attached to this booking (if any). */
  pdfName?: string | null;
  isPublicAttachment?: boolean;
  needAvSupport?: boolean;
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
  facility: { id: string; name: string; hasAvSupport?: boolean };
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
  const [isPublicPurpose, setIsPublicPurpose] = useState(editBooking?.isPublicPurpose ?? false);
  const [needAvSupport, setNeedAvSupport] = useState(editBooking?.needAvSupport ?? false);
  const [pdfName, setPdfName] = useState("");
  const [pdf, setPdf] = useState<File | null>(null);
  const [pdfClear, setPdfClear] = useState(false);
  const [isPublicAttachment, setIsPublicAttachment] = useState(editBooking?.isPublicAttachment ?? false);
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
              label: b.forUser
                ? `${b.forUser.name} (@${b.forUser.username})`
                : `${b.user?.name} (@${b.user?.username})`,
              bookerName: b.user?.name ?? "Unknown",
              bookerUsername: b.user?.username ?? "",
              bookerPrimaryRole: b.user?.primaryRole ?? null,
              forName: b.forUser?.name ?? null,
              forUsername: b.forUser?.username ?? null,
              forPrimaryRole: b.forUser?.primaryRole ?? null,
              purpose: b.purpose ?? null,
              isPublicPurpose: Boolean(b.isPublicPurpose),
              pdf: Boolean(b.pdf),
              pdfName: b.pdfName ?? null,
              isPublicAttachment: Boolean(b.isPublicAttachment),
              needAvSupport: Boolean(b.needAvSupport),
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
          payload.set("isPublicPurpose", isPublicPurpose ? "1" : "0");
          payload.set("isPublicAttachment", isPublicAttachment ? "1" : "0");
          payload.set("needAvSupport", needAvSupport ? "1" : "0");
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
                  isPublicPurpose,
                  isPublicAttachment,
                  needAvSupport,
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
      form.set("isPublicPurpose", isPublicPurpose ? "1" : "0");
      form.set("isPublicAttachment", isPublicAttachment ? "1" : "0");
      form.set("needAvSupport", needAvSupport ? "1" : "0");
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
    setNeedAvSupport(false);
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
              className="gap-1.5 text-red-700 border-red-300 bg-red-50"
              title={
                s.forName
                  ? `Blocked for ${s.forName} (@${s.forUsername || "—"} · ${s.forPrimaryRole || "User"}) by ${s.bookerName} (@${s.bookerUsername || "—"} · ${s.bookerPrimaryRole || "User"})${s.needAvSupport ? " · AV Support Requested" : ""}`
                  : `Booked by ${s.bookerName} (@${s.bookerUsername || "—"} · ${s.bookerPrimaryRole || "User"})${s.needAvSupport ? " · AV Support Requested" : ""}`
              }
            >
              <span>
                {fmtMin(s.startMin)}–{fmtMin(s.endMin)} IST ·{" "}
                {s.forName ? `${s.forName} (@${s.forUsername || "—"})` : `${s.bookerName} (@${s.bookerUsername || "—"})`}
              </span>
              {s.needAvSupport && (
                <span className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded bg-amber-200 text-amber-900 font-bold text-[10px]">
                  <Headphones className="h-2.5 w-2.5" /> AV
                </span>
              )}
            </Badge>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">No bookings today</span>
        )}
      </div>

      {!eligible && (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          This facility is restricted to specific primary roles. Your role ({me.primaryRole ? primaryRoleLabel(me.primaryRole) : "not set"}) is not
          in the allowed list.
          {canPoc ? " As the POC of this facility you can still block a slot for an eligible user." : ""}
        </div>
      )}

      <div className="mt-4 space-y-4">
        <Card className="shadow-sm">
          <CardContent className="p-3 sm:p-4 space-y-3">
            {/* Calendar Controls Toolbar */}
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between border-b pb-3">
              {/* Row 1 on mobile: Navigation + Current Date Heading */}
              <div className="flex flex-wrap items-center justify-between sm:justify-start gap-2">
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={handlePrev} title="Previous">
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={handleNext} title="Next">
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 px-2 text-xs shrink-0" onClick={handleToday}>
                    Today
                  </Button>
                </div>

                <div className="flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-foreground">
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
              </div>

              {/* Row 2 on mobile: Quick Add Button + View Mode Switcher */}
              <div className="flex items-center justify-between sm:justify-end gap-2 sm:ml-auto">
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  className="h-8 gap-1.5 text-xs font-semibold px-3 shadow-xs shrink-0"
                  onClick={() => setShowQuickAdd(true)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add by time</span>
                </Button>

                <div className="flex items-center rounded-lg border bg-muted/50 p-0.5 text-xs">
                  <Button
                    type="button"
                    variant={viewMode === "day" ? "secondary" : "ghost"}
                    size="sm"
                    className="h-7 px-2.5 text-xs"
                    onClick={() => setViewMode("day")}
                  >
                    1 Day
                  </Button>
                  <Button
                    type="button"
                    variant={viewMode === "3day" ? "secondary" : "ghost"}
                    size="sm"
                    className="h-7 px-2.5 text-xs"
                    onClick={() => setViewMode("3day")}
                  >
                    3 Days
                  </Button>
                  <Button
                    type="button"
                    variant={viewMode === "week" ? "secondary" : "ghost"}
                    size="sm"
                    className="h-7 px-2.5 text-xs"
                    onClick={() => setViewMode("week")}
                  >
                    Week
                  </Button>
                </div>
              </div>
            </div>


            {rejectMsg && (
              <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900 shadow-xs animate-in fade-in slide-in-from-top-1 duration-200">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" />
                <span className="font-medium">{rejectMsg}</span>
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
                <div className="mt-2.5 flex items-start gap-2">
                  <Checkbox
                    id={`public-purpose-${facility.id}`}
                    checked={isPublicPurpose}
                    onCheckedChange={(v) => setIsPublicPurpose(v === true)}
                  />
                  <div className="grid gap-0.5 leading-none">
                    <Label htmlFor={`public-purpose-${facility.id}`} className="text-xs font-medium cursor-pointer">
                      Description can be viewed by all
                    </Label>
                    <p className="text-[11px] text-muted-foreground">
                      If unchecked, only you, facility POCs, and app administrators can view the description.
                    </p>
                  </div>
                </div>
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

                <div className="mt-2.5 flex items-start gap-2">
                  <Checkbox
                    id={`public-attachment-${facility.id}`}
                    checked={isPublicAttachment}
                    onCheckedChange={(v) => setIsPublicAttachment(v === true)}
                  />
                  <div className="grid gap-0.5 leading-none">
                    <Label htmlFor={`public-attachment-${facility.id}`} className="text-xs font-medium cursor-pointer">
                      Attachment can be viewed by all
                    </Label>
                    <p className="text-[11px] text-muted-foreground">
                      If unchecked, only you, facility POCs, and app administrators can download the attachment.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* AV Technician Support Checkbox - Only shown if enabled by App Admin for this facility */}
            {facility.hasAvSupport && (
              <div className="rounded-lg border-2 border-amber-300/80 bg-amber-50/70 p-3.5 flex items-start gap-3 shadow-xs animate-in fade-in duration-200">
                <Checkbox
                  id={`av-support-${facility.id}`}
                  checked={needAvSupport}
                  onCheckedChange={(v) => setNeedAvSupport(v === true)}
                  className="mt-0.5 border-amber-400 data-[state=checked]:bg-amber-600 data-[state=checked]:border-amber-600"
                />
                <div className="grid gap-0.5 leading-none">
                  <Label htmlFor={`av-support-${facility.id}`} className="text-xs font-bold text-amber-950 cursor-pointer flex flex-wrap items-center gap-1.5">
                    <Headphones className="h-3.5 w-3.5 text-amber-700 shrink-0" />
                    <span>Need AV Technician Support during this slot</span>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-amber-400 bg-amber-100 text-amber-900 font-medium">
                      Public Notice
                    </Badge>
                  </Label>
                  <p className="text-[11px] text-amber-800 leading-relaxed mt-0.5">
                    Checking this adds an <strong>AV Support</strong> indicator visible to everyone on the calendar so AV technicians are notified and ready to assist during your session.
                  </p>
                </div>
              </div>
            )}

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
          <span className="text-xs text-muted-foreground font-semibold bg-muted px-2 py-0.5 rounded border">
            {fmtDuration(dur)}
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
  const [endTime, setEndTime] = useState("11:00");
  const [err, setErr] = useState<string | null>(null);

  // Helper to compute smart initial start time (avoid past slots on today)
  const getSmartInitialTimes = useCallback((targetDate: string) => {
    let sMin = 10 * 60; // default 10:00 AM
    if (targetDate === todayKey) {
      // Pick next round 30-min interval in future
      const nextMin = Math.ceil((nowMin + 15) / 30) * 30;
      sMin = Math.min(23 * 60, Math.max(8 * 60, nextMin));
    }
    const eMin = Math.min(24 * 60, sMin + 60);
    return {
      start: fmtMin(sMin),
      end: fmtMin(eMin % 1440),
      endDt: eMin >= 1440 ? addDays(targetDate, 1) : targetDate,
    };
  }, [todayKey, nowMin]);

  useEffect(() => {
    if (open) {
      setDate(initialDate);
      const { start, end, endDt } = getSmartInitialTimes(initialDate);
      setStartTime(start);
      setEndTime(end);
      setEndDate(endDt);
      setErr(null);
    }
  }, [open, initialDate, getSmartInitialTimes]);

  // Duration in minutes calculated from current date/time values
  const currentDurationMin = useMemo(() => {
    const sMin = parseTime(startTime);
    const eMin = parseTime(endTime);
    if (sMin === null || eMin === null) return 0;
    const startAbs = slotIndex(date, sMin);
    const endAbs = slotIndex(endDate, eMin === 0 && endDate > date ? 1440 : eMin);
    return Math.max(0, endAbs - startAbs);
  }, [date, endDate, startTime, endTime]);

  // When user changes date, adjust end date if needed
  const handleStartDateChange = (newDate: string) => {
    setDate(newDate);
    if (endDate < newDate) {
      setEndDate(newDate);
    }
    setErr(null);
  };

  // Handle duration preset clicks (15m, 30m, 1h, 2h, etc.)
  const applyPresetDuration = (min: number) => {
    const sMin = parseTime(startTime);
    if (sMin === null) return;
    const endAbs = slotIndex(date, sMin) + min;
    const newEndDt = new Date(endAbs * 60000).toISOString().slice(0, 10);
    const newEMin = endAbs % 1440;
    setEndDate(newEndDt);
    setEndTime(fmtMin(newEMin));
    setErr(null);
  };

  // When user changes Start Time, automatically update End Time by preserving duration
  const handleStartTimeChange = (newStartTime: string) => {
    setStartTime(newStartTime);
    setErr(null);
    const sMin = parseTime(newStartTime);
    if (sMin !== null) {
      const dur = currentDurationMin > 0 ? currentDurationMin : 60;
      const endAbs = slotIndex(date, sMin) + dur;
      const newEndDt = new Date(endAbs * 60000).toISOString().slice(0, 10);
      const newEMin = endAbs % 1440;
      setEndDate(newEndDt);
      setEndTime(fmtMin(newEMin));
    }
  };

  function handleAdd() {
    const sMin = parseTime(startTime);
    if (sMin === null) {
      setErr("Please enter a valid start time (HH:MM).");
      return;
    }
    const eMin = parseTime(endTime);
    if (eMin === null) {
      setErr("Please enter a valid end time (HH:MM).");
      return;
    }
    if (endDate < date) {
      setErr("End date cannot be before the start date.");
      return;
    }
    const startAbs = slotIndex(date, sMin);
    let endAbs = slotIndex(endDate, eMin);
    // If end time is 00:00 on the day after start date, that represents 24:00 (midnight of start date)
    if (eMin === 0 && endDate === addDays(date, 1)) {
      endAbs = slotIndex(date, 1440);
    }
    if (endAbs <= startAbs) {
      setErr("End time must be after the start time.");
      return;
    }
    if (startAbs <= slotIndex(todayKey, nowMin)) {
      setErr("Selected start time must be in the future.");
      return;
    }
    const range: RangeSelection = {
      startDate: date,
      startMin: sMin,
      endDate: endDate,
      endMin: eMin === 0 && endDate === addDays(date, 1) ? 1440 : eMin,
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
            Select a date, start time, and end time or duration to add a slot.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs font-semibold">From date</Label>
              <div className="mt-1">
                <DatePicker
                  value={date}
                  onChange={handleStartDateChange}
                  className="w-full"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs font-semibold">To date</Label>
              <div className="mt-1">
                <DatePicker
                  value={endDate}
                  onChange={(d) => {
                    setEndDate(d);
                    setErr(null);
                  }}
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
                step="900"
                value={startTime}
                onChange={(e) => handleStartTimeChange(e.target.value)}
                className="mt-1 font-medium"
              />
            </div>
            <div>
              <Label className="text-xs font-semibold">End Time (IST)</Label>
              <Input
                type="time"
                step="900"
                value={endTime}
                onChange={(e) => {
                  setEndTime(e.target.value);
                  setErr(null);
                }}
                className="mt-1 font-medium"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
              Quick Duration Presets
            </Label>
            <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
              {[
                { label: "15 min", min: 15 },
                { label: "30 min", min: 30 },
                { label: "45 min", min: 45 },
                { label: "1 hour", min: 60 },
                { label: "2 hours", min: 120 },
                { label: "3 hours", min: 180 },
              ].map((d) => (
                <Button
                  key={d.min}
                  type="button"
                  size="sm"
                  variant={currentDurationMin === d.min ? "default" : "outline"}
                  className="h-8 text-xs px-1"
                  onClick={() => applyPresetDuration(d.min)}
                >
                  {d.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="rounded-lg bg-muted/50 border p-2.5 text-xs flex items-center justify-between">
            <span className="text-muted-foreground">Calculated Duration:</span>
            <span className="font-semibold text-foreground">
              {currentDurationMin > 0 ? fmtDuration(currentDurationMin) : "—"}
            </span>
          </div>

          {err && (
            <div className="rounded-md border border-red-300 bg-red-50 p-2.5 text-xs text-red-700 font-medium flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
              <span>{err}</span>
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

