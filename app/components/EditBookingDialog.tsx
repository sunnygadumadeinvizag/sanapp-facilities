"use client";
import { apiPath } from "iipe-common-ui";
import { useState } from "react";
import { Button } from "@/components/ui/button";
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
import { fmtMin } from "@/lib/ist";

function minToTime(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function EditBookingDialog({
  booking,
  today,
  onClose,
  onSaved,
  onError,
}: {
  booking: {
    id: string;
    date: string;
    endDate: string;
    startMin: number;
    endMin: number;
    purpose: string | null;
    facility: { name: string; building: { name: string } };
  };
  today: string;
  onClose: () => void;
  onSaved: () => void;
  onError: (s: string) => void;
}) {
  const [startDate, setStartDate] = useState(booking.date);
  const [endDate, setEndDate] = useState(booking.endDate || booking.date);
  const [startTime, setStartTime] = useState(minToTime(booking.startMin));
  const [endTime, setEndTime] = useState(minToTime(booking.endMin));
  const [purpose, setPurpose] = useState(booking.purpose ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const payload = {
      id: booking.id,
      startDate,
      endDate: endDate || startDate,
      startMin: timeToMin(startTime),
      endMin: timeToMin(endTime),
      purpose: purpose.trim() || null,
    };
    try {
      const res = await fetch(apiPath("/api/bookings"), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not update the booking");
      onSaved();
    } catch (err) {
      setErr(err instanceof Error ? err.message : "Could not update the booking");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit booking</DialogTitle>
          <DialogDescription>
            {booking.facility.building.name} — {booking.facility.name} · currently{" "}
            {fmtMin(booking.startMin)}–{fmtMin(booking.endMin)} IST on {booking.date}. Change the time
            range or description below.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Start date (IST)</Label>
              <Input type="date" value={startDate} min={today} onChange={(e) => setStartDate(e.target.value)} required />
            </div>
            <div className="grid gap-1.5">
              <Label>End date (IST)</Label>
              <Input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} required />
            </div>
            <div className="grid gap-1.5">
              <Label>Start time</Label>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
            </div>
            <div className="grid gap-1.5">
              <Label>End time</Label>
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Description</Label>
            <Textarea rows={2} value={purpose} onChange={(e) => setPurpose(e.target.value)} />
          </div>
          {err && <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
