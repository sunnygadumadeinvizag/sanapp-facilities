"use client";

import { useMemo, useState } from "react";
import { apiPath } from "sanapp-common-ui";
import { CalendarOff, Clock, Loader2, Save, Timer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { availabilityLines, minuteLabel, WEEKDAY_NAMES } from "@/lib/availability";
import { capLabel } from "@/lib/limits";

/**
 * Availability editor — the bookable hours, the closed days (recurring and
 * one-off) and the longest booking, one facility at a time.
 *
 * Shown to the people who may change it: the app admin, a facility's approval
 * people and its POCs. Narrowing the hours never touches bookings that already
 * exist — the API reports how many upcoming ones now sit outside them.
 */

export type AvailabilityFacility = {
  id: string;
  name: string;
  buildingName: string;
  openMin: number;
  closeMin: number;
  closedWeekdays: number[];
  closedDates: string[];
  maxMinutes: number | null;
  requiresApproval: boolean;
  isLab: boolean;
  hasAvSupport: boolean;
  avSupportRequired: boolean;
  active: boolean;
  buildingMaxMinutes: number | null;
};

/** Minutes to the HH:MM an <input type="time"> understands. */
function timeValue(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** An <input type="time"> value to minutes. "00:00" as a close time is midnight. */
function minutesOf(value: string, isClose: boolean): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  const total = h * 60 + mi;
  if (isClose && total === 0) return 1440;
  return total;
}

const closeLabel = (min: number) => (min >= 1440 ? "24:00 (midnight)" : minuteLabel(min));

export function AvailabilityEditor({ initial }: { initial: AvailabilityFacility[] }) {
  const [openId, setOpenId] = useState<string | null>(initial[0]?.id ?? null);
  const current = useMemo(
    () => initial.find((f) => f.id === openId) ?? initial[0] ?? null,
    [initial, openId]
  );

  if (!current) {
    return (
      <Card>
        <CardContent className="p-5 text-sm text-muted-foreground">
          You do not manage any facility&apos;s availability yet. An app administrator can add you as
          an approval person for a facility.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3 min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Facility
        </Label>
        <select
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={current.id}
          onChange={(e) => setOpenId(e.target.value)}
        >
          {initial.map((f) => (
            <option key={f.id} value={f.id}>
              {f.buildingName} — {f.name}
            </option>
          ))}
        </select>
        {current.isLab && (
          <Badge variant="outline" className="border-sky-400 bg-sky-50 text-sky-900 text-[11px]">
            LAB
          </Badge>
        )}
        {current.hasAvSupport && (
          <Badge
            variant="outline"
            className="border-amber-400 bg-amber-50 text-amber-900 text-[11px]"
          >
            AV{current.avSupportRequired ? " · required" : ""}
          </Badge>
        )}
        {current.requiresApproval && (
          <Badge
            variant="outline"
            className="border-amber-400 bg-amber-50 text-amber-900 text-[11px]"
          >
            Approval required
          </Badge>
        )}
        {!current.active && (
          <Badge variant="outline" className="text-[11px]">
            inactive
          </Badge>
        )}
      </div>

      {/* Remount per facility so each form starts from that facility's values. */}
      <AvailabilityForm key={current.id} facility={current} />
    </div>
  );
}

function AvailabilityForm({ facility }: { facility: AvailabilityFacility }) {
  const [openMin, setOpenMin] = useState(facility.openMin);
  const [closeMin, setCloseMin] = useState(facility.closeMin);
  const [closedWeekdays, setClosedWeekdays] = useState<number[]>(facility.closedWeekdays);
  const [closedDates, setClosedDates] = useState<string[]>(facility.closedDates);
  const [maxMinutes, setMaxMinutes] = useState<number | null>(facility.maxMinutes);
  const [newDate, setNewDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const av = { openMin, closeMin, closedWeekdays, closedDates };

  function toggleWeekday(day: number) {
    setClosedWeekdays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b)
    );
  }

  function addDate() {
    const d = newDate.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      setError("Pick a date to close first.");
      return;
    }
    setError("");
    setClosedDates((prev) => (prev.includes(d) ? prev : [...prev, d].sort()));
    setNewDate("");
  }

  async function save() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(apiPath("/api/facilities/availability"), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: facility.id,
          openMin,
          closeMin,
          closedWeekdays,
          closedDates,
          maxMinutes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save the availability");
      setNotice(data.message ?? "Saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the availability");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-4 grid gap-4">
        {/* Bookable hours */}
        <div className="grid gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Clock className="h-4 w-4 text-primary" />
            Bookable hours of a day
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1">
              <Label className="text-xs">Opens</Label>
              <Input
                type="time"
                className="w-[130px]"
                value={timeValue(openMin)}
                onChange={(e) => {
                  const m = minutesOf(e.target.value, false);
                  if (m !== null) setOpenMin(m);
                }}
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Closes</Label>
              <Input
                type="time"
                className="w-[130px]"
                value={timeValue(closeMin >= 1440 ? 0 : closeMin)}
                onChange={(e) => {
                  const m = minutesOf(e.target.value, true);
                  if (m !== null) setCloseMin(m);
                }}
              />
              <span className="text-[11px] text-muted-foreground">
                {closeLabel(closeMin)} · 00:00 means midnight
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[
                { label: "All day", open: 0, close: 1440 },
                { label: "09:00–18:00", open: 540, close: 1080 },
                { label: "09:00–17:00", open: 540, close: 1020 },
                { label: "08:00–20:00", open: 480, close: 1200 },
              ].map((preset) => (
                <Button
                  key={preset.label}
                  type="button"
                  variant={
                    openMin === preset.open && closeMin === preset.close ? "secondary" : "outline"
                  }
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    setOpenMin(preset.open);
                    setCloseMin(preset.close);
                  }}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            A slot must start at or after the opening time and end by the closing time. Slots outside
            these hours cannot be selected on the booking calendar, and the server refuses them even
            if one is forced.
          </p>
        </div>

        {/* Recurring closures */}
        <div className="grid gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <CalendarOff className="h-4 w-4 text-primary" />
            Closed every week on
          </div>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAY_NAMES.map((name, day) => (
              <Button
                key={name}
                type="button"
                variant={closedWeekdays.includes(day) ? "secondary" : "outline"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => toggleWeekday(day)}
              >
                {name.slice(0, 3)}
              </Button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {closedWeekdays.length === 0
              ? "No weekday is closed — the facility is open every day."
              : `Closed every ${closedWeekdays.map((d) => WEEKDAY_NAMES[d]).join(", ")}.`}
          </p>
        </div>

        {/* One-off closures */}
        <div className="grid gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <CalendarOff className="h-4 w-4 text-primary" />
            Closed on these dates
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="grid gap-1">
              <Label className="text-xs">Add a date</Label>
              <Input
                type="date"
                className="w-[170px]"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
              />
            </div>
            <Button type="button" variant="outline" size="sm" className="h-9" onClick={addDate}>
              Add
            </Button>
          </div>
          {closedDates.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {closedDates.map((d) => (
                <span
                  key={d}
                  className="inline-flex items-center gap-1.5 rounded border bg-muted/40 px-2 py-0.5 text-xs"
                >
                  {d}
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-red-600"
                    onClick={() => setClosedDates((prev) => prev.filter((x) => x !== d))}
                    aria-label={`Remove ${d}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">No one-off closures.</p>
          )}
        </div>

        {/* Maximum booking length */}
        <div className="grid gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Timer className="h-4 w-4 text-primary" />
            Maximum booking length
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {[
              { label: "1 h", minutes: 60 },
              { label: "2 h", minutes: 120 },
              { label: "3 h", minutes: 180 },
              { label: "4 h", minutes: 240 },
              { label: "No limit", minutes: null },
            ].map((preset) => (
              <Button
                key={preset.label}
                type="button"
                variant={maxMinutes === preset.minutes ? "secondary" : "outline"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setMaxMinutes(preset.minutes)}
              >
                {preset.label}
              </Button>
            ))}
            <Input
              type="number"
              min={15}
              max={1440}
              step={15}
              className="w-[120px]"
              value={maxMinutes ?? ""}
              placeholder="minutes"
              aria-label="Maximum booking length in minutes"
              onChange={(e) => {
                const raw = e.target.value;
                setMaxMinutes(raw === "" ? null : Number(raw));
              }}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            {maxMinutes === null
              ? facility.buildingMaxMinutes
                ? `No limit on this facility — its building allows up to ${capLabel(facility.buildingMaxMinutes)}.`
                : "No limit on this facility (the platform default applies)."
              : `One booking may last up to ${capLabel(maxMinutes)}.`}{" "}
            A POC can still block a longer slot for somebody else.
          </p>
        </div>

        {/* What the calendar will show */}
        <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">On the calendar: </span>
          {availabilityLines(av).join(" · ")}
        </div>

        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        {notice && (
          <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {notice}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={() => void save()} disabled={busy} className="gap-1.5">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save availability
          </Button>
          <span className="text-[11px] text-muted-foreground">
            Bookings that already exist are kept — you will be told how many now fall outside the new
            hours.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
