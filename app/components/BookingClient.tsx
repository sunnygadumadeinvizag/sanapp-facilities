"use client";
import { apiPath } from "sanapp-common-ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Crosshair, Loader2, Paperclip, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

function parseTime(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const effMax = useMemo(
    () => effectiveMaxMinutes({ maxMinutes }, roleLimits, me.primaryRole),
    [maxMinutes, roleLimits, me.primaryRole]
  );
  const effMaxLabel = capLabel(effMax);

  // The calendar always shows a full Monday–Sunday week.
  const [weekStart, setWeekStart] = useState(() => mondayOf(today));
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

  const days = useMemo(
    () => Array.from({ length: WEEK_DAYS }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

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
   * Auto-commit a dragged range (called by TimeGrid on pointer release).
   * When the drag touched/overlapped existing selections, TimeGrid passes
   * `mergeIndices` — those are replaced by the merged union (extend mode).
   */
  function commitRange(range: RangeSelection, mergeIndices?: number[]) {
    setRanges((prev) => {
      // In edit mode there is exactly one range — a new drag replaces it.
      if (editBooking) {
        return [{ id: prev[0]?.id ?? ++idRef.current, range }];
      }
      if (mergeIndices && mergeIndices.length > 0) {
        const keep = prev.filter((_, i) => !mergeIndices.includes(i));
        const id = prev[mergeIndices[0]]?.id ?? ++idRef.current;
        return [{ id, range }, ...keep];
      }
      return [...prev, { id: ++idRef.current, range }];
    });
  }

  function rejectRange() {
    setRejectMsg(
      "That range overlaps an already-booked slot or the past — nothing was added."
    );
    if (rejectTimer.current) window.clearTimeout(rejectTimer.current);
    rejectTimer.current = window.setTimeout(() => setRejectMsg(null), 4000);
  }

  function removeRange(id: number) {
    setRanges((prev) => prev.filter((p) => p.id !== id));
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
    setRanges((prev) => {
      let merged = next;
      const absorbed = new Set<number>();
      for (const p of prev) {
        if (p.id === id) continue;
        if (rangesTouch(merged, p.range)) {
          merged = unionRange(merged, p.range);
          absorbed.add(p.id);
        }
      }
      return [{ id, range: merged }, ...prev.filter((p) => p.id !== id && !absorbed.has(p.id))];
    });
    return null;
  }

  const anyLong = ranges.some((p) => slotDurationMin(p.range.startDate, p.range.startMin, p.range.endDate, p.range.endMin) > SLOT_MAX_MINUTES);
  const isOnBehalf = forOther;
  const needPurpose = anyLong || isOnBehalf;

  function overCap(r: RangeSelection): boolean {
    if (isAdmin || effMax === null) return false;
    return slotDurationMin(r.startDate, r.startMin, r.endDate, r.endMin) > effMax;
  }
  const hasOverCap = ranges.some((p) => overCap(p.range));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (ranges.length === 0) return;
    setBusy(true);
    setError(null);
    setSuccess(null);

    // One batchId for every range in this submission (grouped as one booking).
    // Edit mode: PATCH the single existing booking.
    if (editBooking) {
      const { range } = ranges[0];
      try {
        // When the attachment changes (upload/remove), send multipart so the
        // file rides along; otherwise plain JSON with the slot fields.
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
        if (!res.ok) throw new Error(data.error ?? "Could not update the booking");
        setSuccess("Booking updated.");
        setBusy(false);
        onEdited?.();
        // Next appends the basePath to router.push, so pass the unprefixed path.
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
    for (const { range } of ranges) {
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
        if (res.ok) created.push(data.booking?.id ?? "");
        else failed.push(data.error ?? "Could not create the booking");
      } catch {
        failed.push("Network error while creating a booking");
      }
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
    setRanges([]);
    await loadBookings(weekStart);
    setBusy(false);
  }

  return (
    <div>
      {/* Day's schedule chips */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="gap-1">
          <span>{clock.today}</span>
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
        <Card>
            <CardContent className="p-4">
              {/* Week navigation */}
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="icon" onClick={() => setWeekStart((w) => addDays(w, -WEEK_DAYS))}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="icon" onClick={() => setWeekStart((w) => addDays(w, WEEK_DAYS))}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setWeekStart(mondayOf(clock.today))}>
                    Today
                  </Button>
                </div>
                <span className="text-sm font-medium">
                  {days[0]} — {days[days.length - 1]}
                </span>
                {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              </div>

              {rejectMsg && (
                <div className="mb-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {rejectMsg}
                </div>
              )}

              <TimeGrid
                days={days}
                bookings={bookings}
                committed={ranges.map((p) => p.range)}
                onCommit={commitRange}
                onReject={rejectRange}
          nowMin={clock.nowMin}
          todayKey={clock.today}
                maxHeight="60vh"
                onAutoAdvance={(d) => setWeekStart((w) => addDays(w, d))}
                focus={focusReq}
              />
            </CardContent>
          </Card>

          {/* Selected ranges summary */}
          {ranges.length > 0 && (
            <Card>
              <CardContent className="p-4">
                <div className="mb-2 flex items-center gap-2">
                  <h4 className="text-sm font-semibold">Selected ranges ({ranges.length})</h4>
                  {hasOverCap && (
                    <span className="text-xs text-red-600">Some ranges exceed the {effMaxLabel} limit</span>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  {ranges.map(({ id, range }) => {
                    const dur = slotDurationMin(range.startDate, range.startMin, range.endDate, range.endMin);
                    const long = dur > SLOT_MAX_MINUTES;
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
                          setFocusReq({ range, nonce: ++focusNonce.current });
                        }}
                      />
                    );
                  })}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Drag on the calendar to add a range — dragging next to an existing one extends it. Use the pencil
                  to fine-tune From / To, or the crosshair to jump to a range on the calendar.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Booking details */}
          <Card>
          <CardContent className="p-4 space-y-4">
            {!editBooking && canPoc && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={forOther} onCheckedChange={(v) => setForOther(v === true)} />
                Block these ranges for another user (approval access)
              </label>
            )}

            {forOther && (
              <div className="max-w-md">
                <Label>Book for (search name or username)</Label>
                <Input
                  value={forQuery}
                  placeholder="e.g. sanyasi or Sanyasi Naidu"
                  onChange={(e) => {
                    setForQuery(e.target.value);
                    setForUserId("");
                    void searchUsers(e.target.value);
                  }}
                />
                {forResults.length > 0 && (
                  <div className="mt-2 flex flex-col gap-1">
                    {forResults.map((u) => (
                      <Button
                        key={u.id}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="justify-start"
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
                <p className="text-[11px] text-muted-foreground">
                  {editBooking ? "Optional" : "Optional — applies to all ranges"}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                {pdfName && (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Paperclip className="h-3 w-3" /> {pdfName}
                  </span>
                )}
                {!pdfName && existingPdfName && editBooking && (
                  <span className="inline-flex items-center gap-2 text-xs">
                    <a
                      href={apiPath("/api/bookings/" + editBooking.id + "/pdf")}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
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
              {busy ? "Saving…" : editBooking ? "Save changes" : `Confirm ${ranges.length > 1 ? `${ranges.length} ranges` : "booking"}`}
            </Button>
          </CardContent>
        </Card>
      </div>
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
              <DatePicker value={startDate} onChange={setStartDate} className="w-full" />
            </div>
            <div>
              <Label className="text-[10px] uppercase text-muted-foreground">From time (IST)</Label>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="h-8 text-xs" />
            </div>
            <div>
              <Label className="text-[10px] uppercase text-muted-foreground">To date</Label>
              <DatePicker value={endDate} onChange={setEndDate} className="w-full" />
            </div>
            <div>
              <Label className="text-[10px] uppercase text-muted-foreground">To time (IST)</Label>
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="h-8 text-xs" />
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
          <span className="text-xs text-muted-foreground">
            {dur < 60 ? `${dur} min` : `${(dur / 60).toFixed(dur % 60 ? 1 : 0)} h`}
          </span>
          <Badge variant="secondary">
            {long ? "Long (POC)" : forOther ? "On-behalf block" : "Self"}
          </Badge>
          {cap && <span className="text-xs text-red-600">over {effMaxLabel} limit</span>}
          <span className="ml-auto flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              title="Show this range on the calendar"
              onClick={onLocate}
            >
              <Crosshair className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              title="Edit From / To"
              onClick={() => setEditing(true)}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={onRemove}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </span>
        </div>
      )}
    </div>
  );
}
