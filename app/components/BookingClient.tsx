"use client";
import { apiPath } from "iipe-common-ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TimeGrid, type BookingBlock, type RangeSelection } from "./TimeGrid";
import { effectiveMaxMinutes, capLabel } from "@/lib/limits";
import {
  PDF_MAX_BYTES,
  SLOT_MAX_MINUTES,
  addDays,
  fmtMin,
  fmtSlotRange,
  slotDurationMin,
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
  isApprover: boolean;
  isPoc: boolean;
};

const WEEK_DAYS = 7;

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
}) {
  const canApprover = me.isApprover || me.role === "ADMIN";
  const canPoc = me.isPoc || me.role === "ADMIN";
  const isAdmin = me.role === "ADMIN";

  // Effective max for THIS user on THIS facility (admin is exempt server-side).
  const effMax = useMemo(
    () => effectiveMaxMinutes({ maxMinutes }, { maxMinutes: buildingMaxMinutes }, roleLimits, me.primaryRole),
    [maxMinutes, buildingMaxMinutes, roleLimits, me.primaryRole]
  );
  const effMaxLabel = capLabel(effMax);

  const [weekStart, setWeekStart] = useState(today);
  const [bookings, setBookings] = useState<BookingBlock[]>([]);
  const [loading, setLoading] = useState(false);
  const [ranges, setRanges] = useState<RangeSelection[]>([]);
  const [rejectMsg, setRejectMsg] = useState<string | null>(null);
  const [forOther, setForOther] = useState(false);
  const [forQuery, setForQuery] = useState("");
  const [forResults, setForResults] = useState<{ id: string; username: string; name: string }[]>([]);
  const [forUserId, setForUserId] = useState("");
  const [purpose, setPurpose] = useState("");
  const [pdfName, setPdfName] = useState("");
  const [pdf, setPdf] = useState<File | null>(null);
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
  }

  /** Auto-commit a dragged range (called by TimeGrid on pointer release). */
  function commitRange(range: RangeSelection) {
    setRanges((prev) => [...prev, range]);
  }

  function rejectRange() {
    setRejectMsg(
      "That range overlaps an already-booked slot, another range you selected, or the past — nothing was added."
    );
    if (rejectTimer.current) window.clearTimeout(rejectTimer.current);
    rejectTimer.current = window.setTimeout(() => setRejectMsg(null), 4000);
  }

  function removeRange(i: number) {
    setRanges((prev) => prev.filter((_, x) => x !== i));
  }

  const anyLong = ranges.some((r) => slotDurationMin(r.startDate, r.startMin, r.endDate, r.endMin) > SLOT_MAX_MINUTES);
  const isOnBehalf = forOther;
  const needPurpose = anyLong || isOnBehalf;

  /** A range is over this user's permitted maximum (admins are exempt). */
  function overCap(r: RangeSelection): boolean {
    if (isAdmin) return false;
    return slotDurationMin(r.startDate, r.startMin, r.endDate, r.endMin) > effMax;
  }
  const hasOverCap = ranges.some(overCap);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (ranges.length === 0) return;
    setBusy(true);
    setError(null);
    setSuccess(null);

    const created: string[] = [];
    const failed: string[] = [];
    for (const range of ranges) {
      const form = new FormData();
      form.set("facilityId", facility.id);
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
          <span>{today}</span>
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
          {canApprover ? " You can still block a slot for an eligible user using approval access." : ""}
        </div>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        {/* Left column — calendar + selected ranges */}
        <div className="space-y-4">
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
                  <Button variant="ghost" size="sm" onClick={() => setWeekStart(today)}>
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
                committed={ranges}
                onCommit={commitRange}
                onReject={rejectRange}
                nowMin={nowMin}
                todayKey={today}
                maxHeight="60vh"
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
                  {ranges.map((r, i) => {
                    const dur = slotDurationMin(r.startDate, r.startMin, r.endDate, r.endMin);
                    const long = dur > SLOT_MAX_MINUTES;
                    const cap = overCap(r);
                    return (
                      <div
                        key={i}
                        className={`flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 ${
                          cap ? "border-red-300 bg-red-50" : "border-border bg-muted/30"
                        }`}
                      >
                        <Badge variant={long ? "destructive" : cap ? "outline" : "default"}>
                          {fmtSlotRange(r.startDate, r.startMin, r.endDate, r.endMin)}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {dur < 60 ? `${dur} min` : `${(dur / 60).toFixed(dur % 60 ? 1 : 0)} h`}
                        </span>
                        <Badge variant="secondary">
                          {long ? "Long (POC)" : forOther ? "On-behalf block" : "Self"}
                        </Badge>
                        {cap && <span className="text-xs text-red-600">over {effMaxLabel} limit</span>}
                        <span className="ml-auto">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => removeRange(i)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </span>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Drag another range on the calendar to add it — every range stays highlighted until you remove it.
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right column — booking details */}
        <Card className="h-fit xl:sticky xl:top-4">
          <CardContent className="p-4 space-y-4">
            {canApprover && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={forOther} onCheckedChange={(v) => setForOther(v === true)} />
                Block these ranges for another user (approval access)
              </label>
            )}

            {forOther && (
              <div>
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

            <div>
              <Label htmlFor={`purpose-${facility.id}`}>
                Description {needPurpose ? "(required)" : "(optional)"}
              </Label>
              <Textarea
                id={`purpose-${facility.id}`}
                rows={2}
                placeholder={needPurpose ? "Describe the purpose of these bookings" : "Optional — e.g. weekly staff meeting"}
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
              />
            </div>

            <div>
              <Label>Attachment (PDF, max 1 MB, optional — applies to all ranges)</Label>
              <div className="mt-1 flex items-center gap-2">
                <Input type="file" accept="application/pdf,.pdf" onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
                {pdfName && (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Paperclip className="h-3 w-3" /> {pdfName}
                  </span>
                )}
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
              className="w-full"
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
              {busy ? "Booking…" : `Confirm ${ranges.length > 1 ? `${ranges.length} ranges` : "booking"}`}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
