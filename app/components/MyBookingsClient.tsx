"use client";
import { apiPath } from "iipe-common-ui";
import { useEffect, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fmtIstDateTime, fmtSlotRange } from "@/lib/ist";

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

export function MyBookingsClient({ today }: { today: string }) {
  const [bookings, setBookings] = useState<MyBooking[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch(apiPath("/api/bookings?mine=1"), { cache: "no-store" });
      if (!res.ok) throw new Error("Could not load bookings");
      const data = await res.json();
      setBookings(data.bookings);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load bookings");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function cancel(id: string) {
    const reason = window.prompt("Reason for cancelling (optional):") ?? null;
    if (reason === null) return; // user dismissed the prompt
    try {
      const res = await fetch(apiPath(`/api/bookings?id=${id}&reason=${encodeURIComponent(reason)}`), { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not cancel");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel");
    }
  }

  if (error) return <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>;
  if (!bookings) {
    return (
      <p className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading your bookings…
      </p>
    );
  }

  const upcoming = bookings.filter((b) => b.status === "CONFIRMED" && b.date >= today);
  const past = bookings.filter((b) => b.status === "CANCELLED" || b.date < today);

  function renderList(list: MyBooking[], emptyText: string) {
    if (list.length === 0) return <p className="text-muted-foreground">{emptyText}</p>;
    return (
      <div className="grid gap-3">
        {list.map((b) => (
          <Card key={b.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold">
                  {b.facility.building.name} — {b.facility.name}
                </div>
                <div className="text-sm text-muted-foreground">
                  {fmtSlotRange(b.date, b.startMin, b.endDate, b.endMin)}
                </div>
                {b.forUser && (
                  <div className="text-xs text-muted-foreground">
                    Blocked for {b.forUser.name} (@{b.forUser.username})
                  </div>
                )}
                {b.purpose && <p className="mt-1 text-sm">{b.purpose}</p>}
                {b.status === "CANCELLED" && (
                  <div className="mt-1 text-xs text-red-600">
                    Cancelled{b.cancelledBy ? ` by ${b.cancelledBy.name} (@${b.cancelledBy.username})` : ""}
                    {b.cancelledAt ? ` on ${fmtIstDateTime(b.cancelledAt)}` : ""}
                    {b.cancelReason ? ` — ${b.cancelReason}` : ""}
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-2">
                <Badge variant={b.type === "LONG" ? "destructive" : "secondary"}>
                  {b.type === "SELF" ? "Self" : b.type === "ON_BEHALF" ? "Blocked" : "Long"}
                </Badge>
                {b.status === "CANCELLED" && <Badge variant="outline">Cancelled</Badge>}
                <div className="flex gap-2">
                  {b.pdf && (
                    <Button variant="outline" size="sm" asChild>
                      <a href={apiPath(`/api/bookings/${b.id}/pdf`)} target="_blank" rel="noreferrer">
                        <FileText className="h-3 w-3" /> PDF
                      </a>
                    </Button>
                  )}
                  {b.status === "CONFIRMED" && b.date >= today && (
                    <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700" onClick={() => cancel(b.id)}>
                      Cancel
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <section>
        <h2 className="mb-3 text-lg font-semibold">Upcoming</h2>
        {renderList(upcoming, "No upcoming bookings.")}
      </section>
      <section>
        <h2 className="mb-3 text-lg font-semibold">Past &amp; cancelled</h2>
        {renderList(past, "Nothing here yet.")}
      </section>
    </div>
  );
}
