"use client";
import { apiPath } from "iipe-common-ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, FileText, Loader2, Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EditBookingDialog } from "./EditBookingDialog";
import { fmtIstDateTime, fmtMin, fmtSlotRange, slotDurationMin } from "@/lib/ist";

export type MyBooking = {
  id: string;
  type: "SELF" | "ON_BEHALF" | "LONG";
  status: "CONFIRMED" | "CANCELLED";
  date: string;
  endDate: string;
  startMin: number;
  endMin: number;
  purpose: string | null;
  pdf: boolean;
  cancelledAt: string | null;
  cancelReason: string | null;
  cancelledBy: { id: string; username: string; name: string } | null;
  facility: { id: string; name: string; building: { id: string; name: string } };
  forUser: { id: string; username: string; name: string } | null;
};

function minToTime(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

const TYPE_BADGE: Record<MyBooking["type"], { label: string; cls: string }> = {
  SELF: { label: "Self", cls: "bg-primary/15 text-primary border-primary/30" },
  ON_BEHALF: { label: "Blocked for someone", cls: "bg-amber-100 text-amber-800 border-amber-300" },
  LONG: { label: "Long block", cls: "bg-red-100 text-red-800 border-red-300" },
};

export function MyBookingsClient({ today, canEdit }: { today: string; canEdit: boolean }) {
  const [bookings, setBookings] = useState<MyBooking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState("upcoming");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<MyBooking | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(apiPath("/api/bookings?mine=1"), { cache: "no-store" });
      if (!res.ok) throw new Error("Could not load bookings");
      const data = await res.json();
      setBookings(data.bookings);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load bookings");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function cancelOne(id: string) {
    const reason = window.prompt("Reason for cancelling (optional):") ?? null;
    if (reason === null) return;
    await doCancel([id], reason);
  }

  async function cancelSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    const reason = window.prompt(`Reason for cancelling ${ids.length} booking(s) (optional):`) ?? null;
    if (reason === null) return;
    await doCancel(ids, reason);
  }

  async function doCancel(ids: string[], reason: string) {
    try {
      const res = await fetch(
        apiPath(`/api/bookings?id=${ids.join(",")}&reason=${encodeURIComponent(reason)}`),
        { method: "DELETE" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not cancel");
      setSelected(new Set());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel");
    }
  }

  const confirmable = useMemo(
    () => (bookings ?? []).filter((b) => b.status === "CONFIRMED" && b.date >= today),
    [bookings, today]
  );
  const upcoming = confirmable;
  const history = (bookings ?? []).filter((b) => !confirmable.includes(b));
  const list = tab === "upcoming" ? upcoming : history;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    const ids = list.filter((b) => b.status === "CONFIRMED" && b.date >= today).map((b) => b.id);
    setSelected((prev) => (prev.size === ids.length && ids.length > 0 ? new Set() : new Set(ids)));
  }

  if (error) return <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>;
  if (!bookings) {
    return (
      <p className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading your bookings…
      </p>
    );
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="upcoming">Upcoming ({upcoming.length})</TabsTrigger>
            <TabsTrigger value="history">History ({history.length})</TabsTrigger>
          </TabsList>
        </Tabs>
        {tab === "upcoming" && selected.size > 0 && (
          <Button variant="destructive" size="sm" onClick={cancelSelected}>
            <Trash2 className="h-3.5 w-3.5" /> Cancel selected ({selected.size})
          </Button>
        )}
      </div>

      {list.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          {tab === "upcoming" ? "No upcoming bookings." : "No past or cancelled bookings yet."}
        </div>
      ) : (
        <div className="grid gap-3">
          {tab === "upcoming" && (
            <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
              <Checkbox
                checked={selected.size === upcoming.filter((b) => b.status === "CONFIRMED").length && upcoming.length > 0}
                onCheckedChange={() => toggleAll()}
              />
              Select all — cancel several bookings at once
            </div>
          )}
          {list.map((b) => {
            const badge = TYPE_BADGE[b.type];
            const dur = slotDurationMin(b.date, b.startMin, b.endDate, b.endMin);
            const cancellable = b.status === "CONFIRMED" && b.date >= today;
            return (
              <Card key={b.id} className="p-4">
                <div className="flex items-start gap-3">
                  {tab === "upcoming" && (
                    <Checkbox
                      checked={selected.has(b.id)}
                      onCheckedChange={() => toggle(b.id)}
                      disabled={!cancellable}
                      aria-label={`Select ${b.facility.name} booking`}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{b.facility.building.name}</span>
                      <span className="text-muted-foreground">/</span>
                      <span className="font-medium">{b.facility.name}</span>
                      <Badge variant="outline" className={badge.cls}>{badge.label}</Badge>
                      {b.status === "CANCELLED" && <Badge variant="secondary">Cancelled</Badge>}
                    </div>

                    <div className="mt-1.5 flex items-center gap-1.5 text-sm font-medium">
                      <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
                      {fmtSlotRange(b.date, b.startMin, b.endDate, b.endMin)}
                      <span className="text-xs text-muted-foreground">
                        · {dur < 60 ? `${dur} min` : `${(dur / 60).toFixed(dur % 60 ? 1 : 0)} h`}
                      </span>
                    </div>

                    {b.forUser && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Blocked for <strong>{b.forUser.name}</strong> (@{b.forUser.username})
                      </p>
                    )}
                    {b.purpose && <p className="mt-1.5 text-sm">{b.purpose}</p>}

                    {b.status === "CANCELLED" && (
                      <div className="mt-1.5 rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
                        Cancelled{b.cancelledBy ? ` by ${b.cancelledBy.name} (@${b.cancelledBy.username})` : ""}
                        {b.cancelledAt ? ` on ${fmtIstDateTime(b.cancelledAt)}` : ""}
                        {b.cancelReason ? ` — “${b.cancelReason}”` : ""}
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <div className="flex gap-1.5">
                      {b.pdf && (
                        <Button variant="outline" size="icon" className="h-8 w-8" asChild title="Download attachment">
                          <a href={apiPath(`/api/bookings/${b.id}/pdf`)} target="_blank" rel="noreferrer">
                            <FileText className="h-3.5 w-3.5" />
                          </a>
                        </Button>
                      )}
                      {cancellable && canEdit && (
                        <Button variant="outline" size="icon" className="h-8 w-8" title="Edit booking" onClick={() => setEdit(b)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {cancellable && (
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 text-red-600 hover:text-red-700"
                          title="Cancel booking"
                          onClick={() => cancelOne(b.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      {fmtMin(b.startMin)}–{fmtMin(b.endMin)} IST
                    </span>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {edit && <EditBookingDialog booking={edit} today={today} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void load(); }} onError={setError} />}
    </div>
  );
}
