"use client";
import { apiPath } from "iipe-common-ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, FileText, Loader2, Pencil, Search, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtIstDateTime, fmtMin, fmtSlotRange, slotDurationMin } from "@/lib/ist";

type AdminBooking = {
  id: string;
  batchId: string | null;
  type: "SELF" | "ON_BEHALF" | "LONG";
  status: "CONFIRMED" | "CANCELLED";
  date: string;
  endDate: string;
  startMin: number;
  endMin: number;
  purpose: string | null;
  pdf: boolean;
  facility: { id: string; name: string; building: { id: string; name: string } };
  user: { id: string; name: string; username: string };
  forUser: { id: string; name: string; username: string } | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  cancelledBy: { id: string; name: string; username: string } | null;
};

type LocalUser = { id: string; username: string; name: string };
type Building = { id: string; name: string; facilities: { id: string; name: string }[] };

const PAGE_SIZES = [10, 20, 50, 100];
const STATUSES = ["ALL", "CONFIRMED", "CANCELLED"] as const;

export function AdminBookingsTab({ onError, today }: { onError: (s: string | null) => void; today: string }) {
  const [bookings, setBookings] = useState<AdminBooking[] | null>(null);
  const [users, setUsers] = useState<LocalUser[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [statusFilter, setStatusFilter] = useState<(typeof STATUSES)[number]>("ALL");
  const [userId, setUserId] = useState("");
  const [buildingId, setBuildingId] = useState("");
  const [facilityId, setFacilityId] = useState("");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedQ(q.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [q]);

  const buildUrl = useCallback(() => {
    const p = new URLSearchParams({ all: "1" });
    if (debouncedQ) p.set("q", debouncedQ);
    if (statusFilter !== "ALL") p.set("status", statusFilter);
    if (userId) p.set("userId", userId);
    if (buildingId) p.set("buildingId", buildingId);
    if (facilityId) p.set("facilityId", facilityId);
    if (dateFrom) p.set("dateFrom", dateFrom);
    if (dateTo) p.set("dateTo", dateTo);
    return apiPath(`/api/bookings?${p.toString()}`);
  }, [debouncedQ, statusFilter, userId, buildingId, facilityId, dateFrom, dateTo]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(buildUrl(), { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load bookings");
      setBookings(data.bookings);
      setSelected(new Set());
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not load bookings");
    }
  }, [buildUrl, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      const [uRes, bRes] = await Promise.all([
        fetch(apiPath("/api/users"), { cache: "no-store" }),
        fetch(apiPath("/api/buildings"), { cache: "no-store" }),
      ]);
      const uData = await uRes.json().catch(() => ({ users: [] }));
      const bData = await bRes.json().catch(() => ({ buildings: [] }));
      setUsers(uData.users ?? []);
      setBuildings(bData.buildings ?? []);
    })();
  }, []);

  async function cancelMany(ids: string[]) {
    if (ids.length === 0) return;
    const reason = window.prompt(`Reason for cancelling ${ids.length} booking(s) (optional):`) ?? null;
    if (reason === null) return;
    const res = await fetch(
      apiPath(`/api/bookings?id=${ids.join(",")}&reason=${encodeURIComponent(reason)}`),
      { method: "DELETE" }
    );
    const data = await res.json();
    if (!res.ok) return onError(data.error ?? "Could not cancel");
    onError(null);
    setSelected(new Set());
    await load();
  }

  const sorted = useMemo(() => {
    const list = bookings ?? [];
    return [...list].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.startMin - a.startMin));
  }, [bookings]);

  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, page, pageSize]);

  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const cancellableIds = useMemo(
    () => paged.filter((b) => b.status === "CONFIRMED").map((b) => b.id),
    [paged]
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === cancellableIds.length && cancellableIds.length > 0 ? new Set() : new Set(cancellableIds)
    );
  }

  const roomsInBuilding = useMemo(() => {
    const b = buildings.find((x) => x.id === buildingId);
    return b?.facilities ?? [];
  }, [buildings, buildingId]);

  if (bookings === null) {
    return (
      <p className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading bookings…
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      {/* Filter bar */}
      <div className="grid gap-3 rounded-lg border p-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="grid gap-1">
          <Label className="text-xs text-muted-foreground">User</Label>
          <Select value={userId} onValueChange={(v) => { setUserId(v); setPage(1); }}>
            <SelectTrigger><SelectValue placeholder="All users" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All users</SelectItem>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>{u.name} (@{u.username})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label className="text-xs text-muted-foreground">Search</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Facility, purpose, user…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>
        </div>
        <div className="grid gap-1">
          <Label className="text-xs text-muted-foreground">Building</Label>
          <Select value={buildingId} onValueChange={(v) => { setBuildingId(v); setFacilityId(""); setPage(1); }}>
            <SelectTrigger><SelectValue placeholder="All buildings" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All buildings</SelectItem>
              {buildings.map((b) => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label className="text-xs text-muted-foreground">Room (inside building)</Label>
          <Select value={facilityId} onValueChange={(v) => { setFacilityId(v); setPage(1); }} disabled={!buildingId}>
            <SelectTrigger><SelectValue placeholder={buildingId ? "All rooms" : "Pick a building first"} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All rooms</SelectItem>
              {roomsInBuilding.map((f) => (
                <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label className="text-xs text-muted-foreground">From date</Label>
          <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs text-muted-foreground">To date</Label>
          <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs text-muted-foreground">Status</Label>
          <div className="flex flex-wrap items-center gap-2">
            {STATUSES.map((st) => (
              <Button
                key={st}
                size="sm"
                variant={statusFilter === st ? "default" : "outline"}
                onClick={() => { setStatusFilter(st); setPage(1); }}
              >
                {st === "ALL" ? "All" : st === "CONFIRMED" ? "Confirmed" : "Cancelled"}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">{total} booking{total === 1 ? "" : "s"} match</span>
        <span className="ml-auto" />
        {selected.size > 0 && (
          <Button variant="destructive" size="sm" onClick={() => cancelMany([...selected])}>
            <Trash2 className="h-3.5 w-3.5" /> Cancel selected ({selected.size})
          </Button>
        )}
      </div>

      {total === 0 ? (
        <p className="text-muted-foreground">No bookings match the current filters.</p>
      ) : (
        <div className="grid gap-3">
          <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
            <Checkbox
              checked={selected.size === cancellableIds.length && cancellableIds.length > 0}
              onCheckedChange={() => toggleAll()}
              disabled={cancellableIds.length === 0}
            />
            Select all on this page ({cancellableIds.length} confirmed) — cancel several at once
          </div>

          {paged.map((b) => {
            const dur = slotDurationMin(b.date, b.startMin, b.endDate, b.endMin);
            const cancellable = b.status === "CONFIRMED";
            return (
              <Card key={b.id}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={selected.has(b.id)}
                      onCheckedChange={() => toggle(b.id)}
                      disabled={!cancellable}
                      aria-label={`Select ${b.facility.name} booking`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{b.facility.building.name} — {b.facility.name}</span>
                        <Badge variant={b.type === "LONG" ? "destructive" : "secondary"}>
                          {b.type === "SELF" ? "Self" : b.type === "ON_BEHALF" ? "Blocked" : "Long"}
                        </Badge>
                        {b.status === "CANCELLED" && <Badge variant="outline">Cancelled</Badge>}
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                        <CalendarClock className="h-3.5 w-3.5" />
                        {fmtSlotRange(b.date, b.startMin, b.endDate, b.endMin)}
                        <span className="text-xs">
                          · {dur < 60 ? `${dur} min` : `${(dur / 60).toFixed(dur % 60 ? 1 : 0)} h`}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {b.user.name} (@{b.user.username})
                        {b.forUser ? ` → blocked for ${b.forUser.name} (@${b.forUser.username})` : ""}
                      </div>
                      {b.purpose && <p className="mt-1 text-sm">{b.purpose}</p>}
                      {b.status === "CANCELLED" && (
                        <div className="mt-1.5 rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
                          Cancelled{b.cancelledBy ? ` by ${b.cancelledBy.name} (@${b.cancelledBy.username})` : ""}
                          {b.cancelledAt ? ` on ${fmtIstDateTime(b.cancelledAt)}` : ""}
                          {b.cancelReason ? ` — “${b.cancelReason}”` : ""}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      {b.pdf && (
                        <Button variant="outline" size="icon" className="h-8 w-8" asChild title="Attachment">
                          <a href={apiPath(`/api/bookings/${b.id}/pdf`)} target="_blank" rel="noreferrer">
                            <FileText className="h-3.5 w-3.5" />
                          </a>
                        </Button>
                      )}
                      {cancellable && (
                        <Button variant="outline" size="icon" className="h-8 w-8" title="Edit on the booking calendar" asChild>
                          <a href={apiPath(`/book/${b.facility.id}?edit=${b.id}`)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </a>
                        </Button>
                      )}
                      {cancellable && (
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 text-red-600 hover:text-red-700"
                          title="Cancel booking"
                          onClick={() => cancelMany([b.id])}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>
            Showing {total === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
          </span>
          <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
            <SelectTrigger className="h-8 w-[110px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((n) => (
                <SelectItem key={n} value={String(n)}>{n} / page</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
