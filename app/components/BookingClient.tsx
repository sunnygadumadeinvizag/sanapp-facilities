"use client";
import { apiPath } from "iipe-common-ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TimeGrid, type BookingBlock, type RangeSelection } from "./TimeGrid";
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
}: {
  facility: { id: string; name: string };
  buildingName: string;
  today: string;
  todaySlots: SlotItem[];
  me: BookingMe;
  eligible: boolean;
  nowMin?: number;
}) {
  const canApprover = me.isApprover || me.role === "ADMIN";
  const canPoc = me.isPoc || me.role === "ADMIN";

  const [open, setOpen] = useState(false);
  const [weekStart, setWeekStart] = useState(today);
  const [bookings, setBookings] = useState<BookingBlock[]>([]);
  const [loading, setLoading] = useState(false);
  const [selection, setSelection] = useState<RangeSelection | null>(null);
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
    if (open) void loadBookings(weekStart);
  }, [open, weekStart, loadBookings]);

  function openDialog() {
    setError(null);
    setSuccess(null);
    setSelection(null);
    setWeekStart(today);
    setForOther(false);
    setForUserId("");
    setForQuery("");
    setPurpose("");
    setPdf(null);
    setPdfName("");
    setOpen(true);
  }

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

  const duration = selection ? slotDurationMin(selection.startDate, selection.startMin, selection.endDate, selection.endMin) : 0;
  const isLong = duration > SLOT_MAX_MINUTES;
  const isOnBehalf = forOther;
  const needPurpose = isLong || isOnBehalf;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selection) return;
    setBusy(true);
    setError(null);
    setSuccess(null);

    const form = new FormData();
    form.set("facilityId", facility.id);
    form.set("startDate", selection.startDate);
    form.set("endDate", selection.endDate);
    form.set("startMin", String(selection.startMin));
    form.set("endMin", String(selection.endMin));
    if (purpose.trim()) form.set("purpose", purpose.trim());
    if (isOnBehalf && forUserId) form.set("forUserId", forUserId);
    if (pdf) form.set("pdf", pdf, pdf.name);

    try {
      const res = await fetch(apiPath("/api/bookings"), { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not create the booking");
      setSuccess("Booking confirmed.");
      setPurpose("");
      setPdf(null);
      setPdfName("");
      setForUserId("");
      setForQuery("");
      setForResults([]);
      await loadBookings(weekStart);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the booking");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 12 }}>
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
        <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          This facility is restricted to specific primary roles. Your role ({me.primaryRole || "not set"}) is not
          in the allowed list.
          {canApprover ? " You can still block a slot for an eligible user using approval access." : ""}
        </div>
      )}

      <div className="mt-3">
        <Button size="sm" onClick={openDialog} disabled={!eligible && !canApprover}>
          Book a slot
        </Button>
        <span className="ml-2 text-xs text-muted-foreground">
          {buildingName} · {facility.name}
        </span>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Book {facility.name}</DialogTitle>
            <DialogDescription>
              {buildingName} · Drag on the calendar to choose a time range — from 15 minutes up to 3 hours
              (self / on-behalf). Longer blocks (POC) are allowed for designated users. All times are IST.
            </DialogDescription>
          </DialogHeader>

          {/* Week navigation */}
          <div className="flex items-center justify-between">
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

          <TimeGrid
            days={days}
            bookings={bookings}
            selection={selection}
            onSelect={setSelection}
            nowMin={nowMin}
            todayKey={today}
          />

          {selection && (
            <Card>
              <CardContent className="p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Badge variant={isLong ? "destructive" : "default"}>
                    {fmtSlotRange(selection.startDate, selection.startMin, selection.endDate, selection.endMin)}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {duration < 60 ? `${duration} min` : `${(duration / 60).toFixed(duration % 60 ? 1 : 0)} h`}
                  </span>
                  <Badge variant="secondary">
                    {isLong ? "Long (POC)" : forOther ? "On-behalf block" : "Self"}
                  </Badge>
                  {isLong && !canPoc && (
                    <span className="text-xs text-red-600">
                      Longer than 3 hours requires POC designation.
                    </span>
                  )}
                </div>

                {canApprover && !isLong && (
                  <label className="mt-3 flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={forOther}
                      onCheckedChange={(v) => setForOther(v === true)}
                    />
                    Block this slot for another user (approval access)
                  </label>
                )}

                {forOther && (
                  <div className="mt-3">
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

                <div className="mt-3">
                  <Label htmlFor={`purpose-${facility.id}`}>
                    Description {needPurpose ? "(required)" : "(optional)"}
                  </Label>
                  <Textarea
                    id={`purpose-${facility.id}`}
                    rows={2}
                    placeholder={needPurpose ? "Describe the purpose of this booking" : "Optional — e.g. weekly staff meeting"}
                    value={purpose}
                    onChange={(e) => setPurpose(e.target.value)}
                  />
                </div>

                <div className="mt-3">
                  <Label>Attachment (PDF, max 1 MB, optional)</Label>
                  <div className="mt-1 flex items-center gap-2">
                    <Input type="file" accept="application/pdf,.pdf" onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
                    {pdfName && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Paperclip className="h-3 w-3" /> {pdfName}
                      </span>
                    )}
                  </div>
                </div>

                {error && <div className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
                {success && <div className="mt-3 rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700">{success}</div>}

                <DialogFooter className="mt-4">
                  <Button
                    type="submit"
                    onClick={submit}
                    disabled={busy || !selection || (forOther && !forUserId) || (needPurpose && !purpose.trim()) || (isLong && !canPoc)}
                  >
                    {busy ? "Booking…" : isLong ? "Book long slot" : forOther ? "Block slot" : "Book slot"}
                  </Button>
                </DialogFooter>
              </CardContent>
            </Card>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
