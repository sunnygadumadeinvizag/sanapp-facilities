"use client";
import { apiPath } from "sanapp-common-ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, FileText, Loader2, Pencil, Search, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "./DatePicker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmtIstDateTime, fmtMin, fmtSlotRange, slotDurationMin } from "@/lib/ist";

export type MyBooking = {
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
  cancelledAt: string | null;
  cancelReason: string | null;
  cancelledBy: { id: string; username: string; name: string } | null;
  facility: { id: string; name: string; building: { id: string; name: string } };
  forUser: { id: string; username: string; name: string } | null;
};

const TYPE_BADGE: Record<MyBooking["type"], { label: string; cls: string }> = {
  SELF: { label: "Self", cls: "bg-primary/15 text-primary border-primary/30" },
  ON_BEHALF: { label: "Blocked for someone", cls: "bg-amber-100 text-amber-800 border-amber-300" },
  LONG: { label: "Long block", cls: "bg-red-100 text-red-800 border-red-300" },
};

const PAGE_SIZES = [10, 20, 50, 100];

/** A "booking" = one submission. Slots share a batchId (backfilled to the
 *  slot's own id for pre-batch rows, so each is its own booking). */
type BookingGroup = {
  key: string;
  slots: MyBooking[];
};

export function MyBookingsClient({ today, canEdit }: { today: string; canEdit: boolean }) {
  const [bookings, setBookings] = useState<MyBooking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState("upcoming");
  const [view, setView] = useState<"slots" | "bookings">("bookings");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Debounce the search box so we don't hit the API on every keystroke.
  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedQ(q.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [q]);

  const buildUrl = useCallback(() => {
    const p = new URLSearchParams({ mine: "1" });
    if (debouncedQ) p.set("q", debouncedQ);
    if (dateFrom) p.set("dateFrom", dateFrom);
    if (dateTo) p.set("dateTo", dateTo);
    return apiPath(`/api/bookings?${p.toString()}`);
  }, [debouncedQ, dateFrom, dateTo]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(buildUrl(), { cache: "no-store" });
      if (!res.ok) throw new Error("Could not load bookings");
      const data = await res.json();
      setBookings(data.bookings);
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load bookings");
    }
  }, [buildUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  // Upcoming = confirmed and still in the future (its end is today or later).
  const upcoming = useMemo(
    () => (bookings ?? []).filter((b) => b.status === "CONFIRMED" && b.endDate >= today),
    [bookings, today]
  );
  const history = useMemo(
    () => (bookings ?? []).filter((b) => !upcoming.includes(b)),
    [bookings, upcoming]
  );

  const groups = useMemo(() => {
    const map = new Map<string, MyBooking[]>();
    for (const b of (tab === "upcoming" ? upcoming : history)) {
      const key = b.batchId ?? b.id;
      const arr = map.get(key) ?? [];
      arr.push(b);
      map.set(key, arr);
    }
    return [...map.values()]
      .map((slots) => ({ key: slots[0].batchId ?? slots[0].id, slots }))
      .sort((a, b) => (a.slots[0].date < b.slots[0].date ? -1 : 1));
  }, [tab, upcoming, history]);

  // Paginate the current view: bookings view counts groups, slots view counts slots.
  const tabSlots = tab === "upcoming" ? upcoming : history;
  const pagedGroups = useMemo(() => {
    const start = (page - 1) * pageSize;
    return groups.slice(start, start + pageSize);
  }, [groups, page, pageSize]);
  const pagedSlots = useMemo(() => {
    const start = (page - 1) * pageSize;
    return tabSlots.slice(start, start + pageSize);
  }, [tabSlots, page, pageSize]);
  const total = view === "bookings" ? groups.length : tabSlots.length;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

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

  // Which slots are cancellable (confirmed + not started). Used by select-all.
  const cancellableSlotIds = useMemo(() => {
    const pool = view === "bookings"
      ? pagedGroups.flatMap((g) => g.slots)
      : pagedSlots;
    return pool.filter((b) => b.status === "CONFIRMED" && b.endDate >= today).map((b) => b.id);
  }, [view, pagedGroups, pagedSlots, today]);

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
      prev.size === cancellableSlotIds.length && cancellableSlotIds.length > 0
        ? new Set()
        : new Set(cancellableSlotIds)
    );
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
      {/* Tabs + view toggle + bulk cancel */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onValueChange={(v) => { setTab(v); setPage(1); }}>
          <TabsList>
            <TabsTrigger value="upcoming">Upcoming ({upcoming.length})</TabsTrigger>
            <TabsTrigger value="history">History ({history.length})</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          <Tabs value={view} onValueChange={(v) => { setView(v as "slots" | "bookings"); setPage(1); }}>
            <TabsList>
              <TabsTrigger value="bookings">Bookings ({groups.length})</TabsTrigger>
              <TabsTrigger value="slots">Slots ({tabSlots.length})</TabsTrigger>
            </TabsList>
          </Tabs>
          {selected.size > 0 && (
            <Button variant="destructive" size="sm" onClick={cancelSelected}>
              <Trash2 className="h-3.5 w-3.5" /> Cancel selected ({selected.size})
            </Button>
          )}
        </div>
      </div>

      {/* Filters: search + from/to dates */}
      <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_auto_auto]">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search facility, building, purpose, user…"
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">From date</Label>
            <DatePicker value={dateFrom} onChange={(v) => { setDateFrom(v); setPage(1); }} placeholder="Any date" clearable />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">To date</Label>
            <DatePicker value={dateTo} onChange={(v) => { setDateTo(v); setPage(1); }} placeholder="Any date" clearable />
          </div>
        </div>
      </div>

      {total === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          {tab === "upcoming" ? "No upcoming bookings." : "No past or cancelled bookings yet."}
        </div>
      ) : (
        <div className="grid gap-3">
          <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
            <Checkbox
              checked={selected.size === cancellableSlotIds.length && cancellableSlotIds.length > 0}
              onCheckedChange={() => toggleAll()}
              disabled={cancellableSlotIds.length === 0}
            />
            Select all ({cancellableSlotIds.length} cancellable) — cancel several at once
          </div>

          {view === "bookings"
            ? pagedGroups.map((g) => (
                <BookingGroupCard
                  key={g.key}
                  group={g}
                  tab={tab}
                  today={today}
                  canEdit={canEdit}
                  selected={selected}
                  onToggle={toggle}
                  onCancel={cancelOne}
                />
              ))
            : pagedSlots.map((b) => (
                <SlotCard
                  key={b.id}
                  b={b}
                  tab={tab}
                  today={today}
                  canEdit={canEdit}
                  selected={selected}
                  onToggle={toggle}
                  onCancel={cancelOne}
                />
              ))}
        </div>
      )}

      {/* Pagination */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>
            Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
            {view === "bookings" ? " bookings" : " slots"}
          </span>
          <Select
            value={String(pageSize)}
            onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}
          >
            <SelectTrigger className="h-8 w-[110px]">
              <SelectValue />
            </SelectTrigger>
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
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------- one booking (grouped) card ------------------------- */

function BookingGroupCard({
  group,
  tab,
  today,
  canEdit,
  selected,
  onToggle,
  onCancel,
}: {
  group: BookingGroup;
  tab: string;
  today: string;
  canEdit: boolean;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  const first = group.slots[0];
  const totalMin = group.slots.reduce((acc, b) => acc + slotDurationMin(b.date, b.startMin, b.endDate, b.endMin), 0);
  const confirmedCount = group.slots.filter((b) => b.status === "CONFIRMED").length;
  const cancellable = group.slots.filter((b) => b.status === "CONFIRMED" && b.endDate >= today);
  const allCancelled = confirmedCount === 0;

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{first.facility.building.name}</span>
            <span className="text-muted-foreground">/</span>
            <span className="font-medium">{first.facility.name}</span>
            <Badge variant="secondary">{group.slots.length} slot{group.slots.length === 1 ? "" : "s"}</Badge>
            <Badge variant="outline">{allCancelled ? "Cancelled" : `${confirmedCount} confirmed`}</Badge>
            {first.forUser && (
              <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-300">
                Blocked for {first.forUser.name}
              </Badge>
            )}
          </div>

          <div className="mt-2 flex flex-col gap-1.5">
            {group.slots.map((b) => {
              const dur = slotDurationMin(b.date, b.startMin, b.endDate, b.endMin);
              const badge = TYPE_BADGE[b.type];
              return (
                <div key={b.id} className="flex flex-wrap items-center gap-2 rounded-md bg-muted/40 px-2.5 py-1.5">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
                    {fmtSlotRange(b.date, b.startMin, b.endDate, b.endMin)}
                    <span className="text-xs text-muted-foreground">
                      · {dur < 60 ? `${dur} min` : `${(dur / 60).toFixed(dur % 60 ? 1 : 0)} h`}
                    </span>
                  </div>
                  <Badge variant="outline" className={badge.cls}>{badge.label}</Badge>
                  {b.status === "CANCELLED" && (
                    <Badge variant="secondary" className="gap-1">
                      Cancelled{b.cancelledBy ? ` by ${b.cancelledBy.name}` : ""}
                      {b.cancelReason ? ` — “${b.cancelReason}”` : ""}
                    </Badge>
                  )}
                  <span className="ml-auto flex items-center gap-1.5">
                    {b.pdf && (
                      <Button variant="outline" size="icon" className="h-7 w-7" asChild title="Download attachment">
                        <a href={apiPath(`/api/bookings/${b.id}/pdf`)} target="_blank" rel="noreferrer">
                          <FileText className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                    )}
                    {tab === "upcoming" && (
                      <Checkbox
                        checked={selected.has(b.id)}
                        onCheckedChange={() => onToggle(b.id)}
                        disabled={b.status !== "CONFIRMED" || b.endDate < today}
                        aria-label={`Select ${b.facility.name} slot ${fmtSlotRange(b.date, b.startMin, b.endDate, b.endMin)}`}
                      />
                    )}
                    {cancellable.some((c) => c.id === b.id) && canEdit && (
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        title="Edit this slot on the booking calendar"
                        asChild
                      >
                        <a href={apiPath(`/book/${b.facility.id}?edit=${b.id}`)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                    )}
                    {cancellable.some((c) => c.id === b.id) && (
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7 text-red-600 hover:text-red-700"
                        title="Cancel this slot"
                        onClick={() => onCancel(b.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>

          {first.purpose && <p className="mt-2 text-sm">{first.purpose}</p>}
          <p className="mt-1 text-xs text-muted-foreground">
            Total {totalMin < 60 ? `${totalMin} min` : `${(totalMin / 60).toFixed(totalMin % 60 ? 1 : 0)} h`} across {group.slots.length} slot{group.slots.length === 1 ? "" : "s"}
            {allCancelled && first.cancelledAt ? ` · cancelled ${fmtIstDateTime(first.cancelledAt)}` : ""}
          </p>
        </div>
      </div>
    </Card>
  );
}

/* ----------------------------- one slot card ----------------------------- */

function SlotCard({
  b,
  tab,
  today,
  canEdit,
  selected,
  onToggle,
  onCancel,
}: {
  b: MyBooking;
  tab: string;
  today: string;
  canEdit: boolean;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  const badge = TYPE_BADGE[b.type];
  const dur = slotDurationMin(b.date, b.startMin, b.endDate, b.endMin);
  const cancellable = b.status === "CONFIRMED" && b.endDate >= today;
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        {tab === "upcoming" && (
          <Checkbox
            checked={selected.has(b.id)}
            onCheckedChange={() => onToggle(b.id)}
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
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                title="Edit on the booking calendar"
                asChild
              >
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
                onClick={() => onCancel(b.id)}
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
}
