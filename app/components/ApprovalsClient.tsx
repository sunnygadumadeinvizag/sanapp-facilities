"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiPath } from "sanapp-common-ui";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FlaskConical,
  GraduationCap,
  Headphones,
  Loader2,
  RefreshCw,
  ThumbsDown,
  ThumbsUp,
  User,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { fmtDuration, fmtMin, fmtSlotRange, slotDurationMin } from "@/lib/ist";

/** One slot of a request, as the approvals API returns it. */
export type ApprovalRow = {
  id: string;
  code: string;
  batchId: string | null;
  facilityId: string;
  facilityName: string;
  buildingName: string;
  date: string;
  endDate: string;
  startMin: number;
  endMin: number;
  status: string;
  type: string;
  purpose: string | null;
  needAvSupport: boolean;
  /** LAB facilities: the label, the supervisor and the department. */
  isLab: boolean;
  supervisorName: string | null;
  supervisorUsername: string | null;
  department: string | null;
  bookerId: string;
  bookerName: string;
  bookerUsername: string;
  forName: string | null;
  forUsername: string | null;
  requestedAt: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
};

export type ApprovalFacility = { id: string; name: string; buildingName: string };

/** One request = every slot raised in the same submission, decided together. */
type RequestGroup = {
  key: string;
  code: string;
  facilityId: string;
  facilityName: string;
  buildingName: string;
  bookerName: string;
  bookerUsername: string;
  requestedAt: string | null;
  purpose: string | null;
  needAvSupport: boolean;
  isLab: boolean;
  supervisorName: string | null;
  supervisorUsername: string | null;
  department: string | null;
  slots: ApprovalRow[];
};

function groupRequests(rows: ApprovalRow[]): RequestGroup[] {
  const groups = new Map<string, RequestGroup>();
  for (const row of rows) {
    const key = row.batchId ?? row.id;
    const existing = groups.get(key);
    if (existing) {
      existing.slots.push(row);
      existing.needAvSupport = existing.needAvSupport || row.needAvSupport;
      continue;
    }
    groups.set(key, {
      key,
      code: row.code,
      facilityId: row.facilityId,
      facilityName: row.facilityName,
      buildingName: row.buildingName,
      bookerName: row.bookerName,
      bookerUsername: row.bookerUsername,
      requestedAt: row.requestedAt,
      purpose: row.purpose,
      needAvSupport: row.needAvSupport,
      isLab: row.isLab,
      supervisorName: row.supervisorName,
      supervisorUsername: row.supervisorUsername,
      department: row.department,
      slots: [row],
    });
  }
  for (const g of groups.values()) {
    g.slots.sort((a, b) => (a.date === b.date ? a.startMin - b.startMin : a.date < b.date ? -1 : 1));
  }
  return [...groups.values()].sort((a, b) => {
    const aStart = a.slots[0];
    const bStart = b.slots[0];
    return aStart.date === bStart.date
      ? aStart.startMin - bStart.startMin
      : aStart.date < bStart.date
        ? -1
        : 1;
  });
}

/** "2 Sep 2026, 14:05" — a server timestamp shown in IST. */
function fmtStamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ApprovalsClient({
  initialPending,
  initialDecided,
  initialFacilities,
}: {
  initialPending: ApprovalRow[];
  initialDecided: ApprovalRow[];
  initialFacilities: ApprovalFacility[];
}) {
  const [pending, setPending] = useState<ApprovalRow[]>(initialPending);
  const [decided, setDecided] = useState<ApprovalRow[]>(initialDecided);
  const [facilities, setFacilities] = useState<ApprovalFacility[]>(initialFacilities);
  const [facilityFilter, setFacilityFilter] = useState("all");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async (facilityId: string) => {
    setLoading(true);
    try {
      const query = facilityId && facilityId !== "all" ? `?facilityId=${encodeURIComponent(facilityId)}` : "";
      const res = await fetch(apiPath(`/api/approvals${query}`), { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load the approval queue");
      setPending(data.pending ?? []);
      setDecided(data.decided ?? []);
      setFacilities(data.facilities ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the approval queue");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setError("");
    void refresh(facilityFilter);
  }, [facilityFilter, refresh]);

  const groups = useMemo(() => groupRequests(pending), [pending]);
  const decidedGroups = useMemo(() => groupRequests(decided), [decided]);

  async function decide(group: RequestGroup, decision: "approve" | "decline") {
    setBusyKey(group.key);
    setError("");
    setNotice("");
    try {
      const res = await fetch(apiPath("/api/approvals"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          bookingIds: group.slots.map((s) => s.id),
          decision,
          note: notes[group.key] ?? "",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not record the decision");
      setNotice(data.message ?? "Decision recorded");
      setNotes((prev) => {
        const next = { ...prev };
        delete next[group.key];
        return next;
      });
      await refresh(facilityFilter);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record the decision");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="flex flex-col gap-4 min-w-0">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1">
            <Clock className="h-3 w-3" />
            {pending.length} slot{pending.length === 1 ? "" : "s"} waiting
          </Badge>
          {groups.length !== pending.length && (
            <Badge variant="secondary">
              {groups.length} request{groups.length === 1 ? "" : "s"}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Select value={facilityFilter} onValueChange={setFacilityFilter}>
            <SelectTrigger className="w-[240px]">
              <SelectValue placeholder="All facilities I approve" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All facilities I approve</SelectItem>
              {facilities.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.buildingName} — {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => void refresh(facilityFilter)} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </Button>
        </div>
      </div>

      {notice && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="text-destructive">{error}</span>
        </div>
      )}

      {groups.length === 0 ? (
        <Card>
          <CardContent className="p-6 flex flex-col gap-1">
            <h2 className="text-lg font-semibold">Nothing is waiting for your decision</h2>
            <p className="text-sm text-muted-foreground">
              Requests raised on a facility that needs an approval appear here — and they are
              emailed to you the moment they are made.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((group) => (
            <Card key={group.key} className="overflow-hidden">
              <CardContent className="p-4 flex flex-col gap-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex flex-col gap-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="border-amber-400 bg-amber-100 text-amber-900 gap-1">
                        <Clock className="h-3 w-3" />
                        Awaiting approval
                      </Badge>
                      <span className="font-semibold text-sm">
                        {group.buildingName} — {group.facilityName}
                      </span>
                      {group.isLab && (
                        <Badge
                          variant="outline"
                          className="border-sky-400 bg-sky-50 text-sky-900 gap-1 text-[11px]"
                        >
                          <FlaskConical className="h-3 w-3" />
                          LAB
                        </Badge>
                      )}
                      <code className="text-[11px] rounded bg-muted px-1.5 py-0.5">{group.code}</code>
                    </div>
                    <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="inline-flex items-center gap-1">
                        <User className="h-3 w-3" />
                        {group.bookerName} (@{group.bookerUsername})
                      </span>
                      <span>Requested {fmtStamp(group.requestedAt)} IST</span>
                      {group.needAvSupport && (
                        <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300 font-medium">
                          <Headphones className="h-3 w-3" />
                          AV support needed
                        </span>
                      )}
                      {(group.supervisorName || group.department) && (
                        <span className="inline-flex items-center gap-1">
                          <GraduationCap className="h-3 w-3" />
                          {group.supervisorName
                            ? `Supervisor: ${group.supervisorName}${
                                group.supervisorUsername ? ` (@${group.supervisorUsername})` : ""
                              }`
                            : "Supervisor: not recorded"}
                          {group.department ? ` · ${group.department}` : ""}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {group.purpose && (
                  <p className="text-sm rounded-lg bg-muted/50 border px-3 py-2 break-words">
                    {group.purpose}
                  </p>
                )}

                <div className="rounded-lg border divide-y">
                  {group.slots.map((slot) => (
                    <div
                      key={slot.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
                    >
                      <span className="font-medium tabular-nums">
                        {fmtSlotRange(slot.date, slot.startMin, slot.endDate, slot.endMin)}
                      </span>
                      <span className="text-muted-foreground tabular-nums">
                        {fmtDuration(slotDurationMin(slot.date, slot.startMin, slot.endDate, slot.endMin))}
                      </span>
                    </div>
                  ))}
                </div>

                <Textarea
                  value={notes[group.key] ?? ""}
                  onChange={(e) => setNotes((prev) => ({ ...prev, [group.key]: e.target.value }))}
                  placeholder="Optional note for the requester (it is emailed with your decision)"
                  rows={2}
                  maxLength={500}
                />

                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => void decide(group, "approve")}
                    disabled={busyKey !== null}
                    className="gap-1.5"
                  >
                    {busyKey === group.key ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ThumbsUp className="h-4 w-4" />
                    )}
                    Approve &amp; confirm
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void decide(group, "decline")}
                    disabled={busyKey !== null}
                    className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10"
                  >
                    {busyKey === group.key ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ThumbsDown className="h-4 w-4" />
                    )}
                    Decline
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {decidedGroups.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold mt-2">Recently decided</h2>
          <div className="flex flex-col gap-2">
            {decidedGroups.slice(0, 10).map((group) => {
              const approved = group.slots.every((s) => s.status === "CONFIRMED");
              return (
                <Card key={group.key}>
                  <CardContent className="p-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <Badge
                      variant="outline"
                      className={
                        approved
                          ? "border-emerald-300 bg-emerald-100 text-emerald-900"
                          : "border-red-300 bg-red-100 text-red-900"
                      }
                    >
                      {approved ? "Approved" : "Declined"}
                    </Badge>
                    <span className="font-medium">
                      {group.buildingName} — {group.facilityName}
                    </span>
                    <span className="text-muted-foreground">
                      {group.bookerName} (@{group.bookerUsername})
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {fmtMin(group.slots[0].startMin)} {group.slots[0].date}
                      {group.slots.length > 1 ? ` +${group.slots.length - 1} more` : ""}
                    </span>
                    <span className="text-muted-foreground">
                      by {group.slots[0].decidedBy ?? "—"} · {fmtStamp(group.slots[0].decidedAt)}
                    </span>
                    {group.slots[0].decisionNote && (
                      <span className="italic text-muted-foreground break-words">
                        “{group.slots[0].decisionNote}”
                      </span>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
