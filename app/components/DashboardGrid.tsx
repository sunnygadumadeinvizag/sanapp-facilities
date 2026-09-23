"use client";
import { apiPath } from "sanapp-common-ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, CalendarClock, Headphones, Loader2, Settings2, ShieldCheck, Users2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { MultiSearchableSelect } from "@/components/ui/multi-searchable-select";
import { fmtMin } from "@/lib/ist";

export type DashSlot = {
  id: string;
  code: string;
  facilityId: string;
  date: string;
  endDate: string;
  startMin: number;
  endMin: number;
  purpose: string | null;
  needAvSupport: boolean;
  bookedBy: string;
};

export type DashFacility = { id: string; name: string; buildingName: string };

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = start; t <= end; t += DAY_MS) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** Slots of one day in one column — includes multi-day slots that cover it. */
function daySlots(all: DashSlot[], day: string, facilityId: string): DashSlot[] {
  const dayIdx = Date.parse(`${day}T00:00:00Z`) / 60000;
  return all
    .filter(
      (s) =>
        s.facilityId === facilityId &&
        dayIdx >= Date.parse(`${s.date}T00:00:00Z`) / 60000 &&
        dayIdx <= Date.parse(`${s.endDate}T00:00:00Z`) / 60000
    )
    .sort((a, b) => (a.date === day ? (b.date === day ? a.startMin - b.startMin : -1) : 1));
}

function DayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return d.toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" });
}

export function DashboardGrid({
  today,
  from,
  to,
  facilities,
  slots,
  unconfigured,
  canConfigure,
}: {
  today: string;
  from: string;
  to: string;
  facilities: DashFacility[];
  slots: DashSlot[];
  unconfigured: boolean;
  canConfigure: boolean;
}) {
  const days = useMemo(() => daysBetween(from, to), [from, to]);

  return (
    <div className="grid gap-4">
      {unconfigured && canConfigure && (
        <Card className="border-dashed">
          <CardContent className="flex items-start gap-3 p-5 text-sm text-muted-foreground">
            <Settings2 className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              No facilities have been added to this dashboard yet. Use{" "}
              <strong className="text-foreground">Configure dashboard</strong> below to pick the
              facilities and who can view this page.
            </p>
          </CardContent>
        </Card>
      )}

      {facilities.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            No facilities selected for this dashboard yet.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6">
          {facilities.map((f) => {
            const facilitySlots = slots.filter((s) => s.facilityId === f.id);
            return (
              <Card key={f.id} className="overflow-hidden">
                <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-4 py-3">
                  <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">{f.buildingName}</span>
                  <span className="text-muted-foreground">/</span>
                  <span className="font-semibold">{f.name}</span>
                  <Badge variant="secondary" className="ml-auto">
                    {facilitySlots.length} slot{facilitySlots.length === 1 ? "" : "s"} this week
                  </Badge>
                </div>
                <CardContent className="p-3">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
                    {days.map((day) => {
                      const list = daySlots(facilitySlots, day, f.id);
                      const isToday = day === today;
                      return (
                        <div
                          key={day}
                          className={`rounded-lg border p-2 ${isToday ? "border-primary/40 bg-primary/5 shadow-sm" : "bg-card"}`}
                        >
                          <div className="mb-2 flex items-baseline justify-between">
                            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                              {DayLabel(day)}
                            </span>
                            <span className={`text-xs font-medium ${isToday ? "text-primary" : "text-muted-foreground"}`}>
                              {day.slice(5)}
                            </span>
                          </div>
                          {list.length === 0 ? (
                            <p className="py-3 text-center text-xs text-muted-foreground/50">—</p>
                          ) : (
                            <div className="grid gap-1.5">
                              {list.map((s) => (
                                <div
                                  key={s.id + day}
                                  className="rounded-md border-l-2 border-l-primary/60 bg-muted/60 px-2 py-1.5 text-xs"
                                  title={s.purpose ?? undefined}
                                >
                                  <div className="flex items-center gap-1 font-medium">
                                    <CalendarClock className="h-3 w-3 shrink-0 text-primary" />
                                    <span className="truncate">
                                      {day === s.date && s.endDate === day
                                        ? `${fmtMin(s.startMin)}–${fmtMin(s.endMin)}`
                                        : day === s.date
                                          ? `from ${fmtMin(s.startMin)}`
                                          : day === s.endDate
                                            ? `until ${fmtMin(s.endMin)}`
                                            : "all day"}
                                    </span>
                                  </div>
                                  {s.needAvSupport && (
                                    <Badge variant="outline" className="mt-1 gap-0.5 border-amber-400 bg-amber-100 text-amber-900 px-1 py-0 text-[10px]">
                                      <Headphones className="h-2.5 w-2.5" /> AV
                                    </Badge>
                                  )}
                                  <div className="mt-1 truncate text-muted-foreground" title={s.bookedBy}>
                                    {s.bookedBy}
                                  </div>
                                  {s.purpose && <div className="mt-0.5 line-clamp-2 text-[11px]">{s.purpose}</div>}
                                  <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">{s.code}</div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {canConfigure && <DashboardConfigEditor currentFacilityIds={facilities.map((f) => f.id)} />}
    </div>
  );
}

/* ------------------------------ config editor ------------------------------ */

type AllFacility = { id: string; name: string; buildingName: string; active: boolean };
type UserOption = { username: string; name: string };

function DashboardConfigEditor({ currentFacilityIds }: { currentFacilityIds: string[] }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState<AllFacility[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set(currentFacilityIds));
  const [allowed, setAllowed] = useState<string[]>([]);
  const [admins, setAdmins] = useState<UserOption[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setAll(null);
    setAdmins(null);
    try {
      const [fRes, cRes, aRes] = await Promise.all([
        fetch(apiPath("/api/facilities"), { cache: "no-store" }),
        fetch(apiPath("/api/admin/dashboard-config"), { cache: "no-store" }),
        fetch(apiPath("/api/users?kind=admins"), { cache: "no-store" }),
      ]);
      const fData = await fRes.json().catch(() => ({ facilities: [] }));
      setAll(
        (fData.facilities ?? []).map((f: { id: string; name: string; building?: { name?: string }; active?: boolean }) => ({
          id: f.id,
          name: f.name,
          buildingName: f.building?.name ?? "",
          active: f.active !== false,
        }))
      );
      if (cRes.ok) {
        const cData = await cRes.json();
        setPicked(new Set(cData.facilityIds ?? []));
        setAllowed(cData.allowedUsernames ?? []);
      }
      if (aRes.ok) {
        const aData = await aRes.json();
        setAdmins(
          (aData.users ?? []).map((u: { username: string; name: string }) => ({
            username: u.username,
            name: u.name,
          }))
        );
      } else {
        setAdmins([]);
      }
    } catch {
      setErr("Could not load configuration");
    }
  }, []);

  async function save() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch(apiPath("/api/admin/dashboard-config"), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ facilityIds: [...picked], allowedUsernames: allowed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save");
      setMsg("Dashboard configuration saved.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div>
        <Button variant="outline" onClick={() => { setOpen(true); void load(); }}>
          <Settings2 className="h-4 w-4" /> Configure dashboard
        </Button>
      </div>
    );
  }

  const facilityOptions = (all ?? []).map((f) => ({
    value: f.id,
    label: f.name,
    hint: f.buildingName,
    keywords: f.buildingName,
  }));

  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold">Configure dashboard</h3>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            <X className="h-4 w-4" /> Close
          </Button>
        </div>
        {err && <div className="mb-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
        {msg && <div className="mb-3 rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700">{msg}</div>}
        {all === null ? (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : (
          <div className="grid gap-5">
            <div className="grid gap-2">
              <Label className="flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5 text-muted-foreground" /> Facilities shown on the dashboard
              </Label>
              <MultiSearchableSelect
                aria-label="Facilities shown on the dashboard"
                value={[...picked]}
                onValueChange={(vals) => setPicked(new Set(vals))}
                options={facilityOptions}
                placeholder="Search and pick facilities…"
                searchPlaceholder="Type to filter facilities…"
                emptyText="No facilities match"
              />
              <p className="text-xs text-muted-foreground">
                Only these facilities&apos; confirmed slots will appear on the dashboard.
              </p>
            </div>
            <div className="grid gap-2">
              <Label className="flex items-center gap-1.5">
                <Users2 className="h-3.5 w-3.5 text-muted-foreground" /> Who can view this dashboard
              </Label>
              <MultiSearchableSelect
                aria-label="Users who can view this dashboard"
                value={allowed}
                onValueChange={setAllowed}
                options={(admins ?? []).map((u) => ({
                  value: u.username,
                  label: u.name,
                  hint: `@${u.username}`,
                }))}
                placeholder={allowed.length === 0 ? "Every app admin can view" : "Search and pick users…"}
                searchPlaceholder="Type a name or username…"
                emptyText="No app admins match"
              />
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {allowed.length === 0
                  ? "Empty — every app admin can view the dashboard. Pick specific users to restrict it."
                  : "Only the picked users (plus the central super admin) can view the dashboard."}
              </p>
            </div>
            <div className="flex items-center gap-2 border-t pt-4">
              <Button onClick={save} disabled={busy}>
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Saving…
                  </>
                ) : (
                  "Save configuration"
                )}
              </Button>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
