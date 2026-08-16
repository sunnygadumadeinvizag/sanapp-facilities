"use client";
import { apiPath } from "sanapp-common-ui";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, ParkingSquare, RotateCcw, Send, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { fmtIstDateTime, fmtSlotRange } from "@/lib/ist";

type ParkingSlot = {
  id: string;
  name: string;
  area: string | null;
  slotType: "RESERVED" | "GENERAL";
  notes: string | null;
};

type ParkingRequest = {
  id: string;
  date: string;
  endDate: string;
  startMin: number;
  endMin: number;
  vehicleNo: string;
  purpose: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "COMPLETED" | "CANCELLED";
  remarks: string | null;
  decidedAt: string | null;
  createdAt: string;
  slot: { id: string; name: string; area: string | null; slotType: string };
  user: { id: string; username: string; name: string };
  decidedBy: { id: string; username: string; name: string } | null;
};

const STATUS_BADGE: Record<ParkingRequest["status"], { label: string; cls: string }> = {
  PENDING: { label: "Pending", cls: "bg-amber-100 text-amber-800 border-amber-300" },
  APPROVED: { label: "Approved", cls: "bg-green-100 text-green-800 border-green-300" },
  REJECTED: { label: "Rejected", cls: "bg-red-100 text-red-800 border-red-300" },
  COMPLETED: { label: "Completed", cls: "bg-blue-100 text-blue-800 border-blue-300" },
  CANCELLED: { label: "Cancelled", cls: "bg-slate-200 text-slate-700 border-slate-300" },
};

/** 15-minute time options: 00:00 … 23:45. */
function timeOptions(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (let m = 0; m < 24 * 60; m += 15) {
    const h = Math.floor(m / 60).toString().padStart(2, "0");
    const min = (m % 60).toString().padStart(2, "0");
    out.push({ value: String(m), label: `${h}:${min}` });
  }
  return out;
}
const TIMES = timeOptions();

export function ParkingClient({ today }: { today: string }) {
  const [slots, setSlots] = useState<ParkingSlot[]>([]);
  const [myRequests, setMyRequests] = useState<ParkingRequest[]>([]);
  const [allRequests, setAllRequests] = useState<ParkingRequest[]>([]);
  const [canDecide, setCanDecide] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [slotId, setSlotId] = useState("");
  const [vehicleNo, setVehicleNo] = useState("");
  const [date, setDate] = useState(today);
  const [startMin, setStartMin] = useState(String(9 * 60));
  const [endMin, setEndMin] = useState(String(17 * 60));
  const [purpose, setPurpose] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [sRes, mineRes, allRes] = await Promise.all([
        fetch(apiPath("/api/parking-slots"), { cache: "no-store" }),
        fetch(apiPath("/api/parking-requests?scope=mine"), { cache: "no-store" }),
        fetch(apiPath("/api/parking-requests?scope=all"), { cache: "no-store" }),
      ]);
      if (!sRes.ok || !mineRes.ok) throw new Error("Failed to load parking data");
      const sData = await sRes.json();
      const mineData = await mineRes.json();
      setSlots(sData.slots);
      setMyRequests(mineData.requests);
      setCanDecide(mineData.canDecide === true);
      if (allRes.ok) {
        const allData = await allRes.json();
        setAllRequests(allData.requests);
      }
      if (!slotId && sData.slots.length > 0) setSlotId(sData.slots[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load parking data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submitRequest() {
    setError(null);
    setSuccess(null);
    if (!slotId) return setError("Select a parking slot");
    if (!vehicleNo.trim()) return setError("Vehicle registration number is required");
    setSubmitting(true);
    try {
      const res = await fetch(apiPath("/api/parking-requests"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slotId,
          vehicleNo,
          date,
          startMin: Number(startMin),
          endMin: Number(endMin),
          purpose,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to submit the request");
      setSuccess("Parking request submitted — the logistics POC will review it.");
      setVehicleNo("");
      setPurpose("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit the request");
    } finally {
      setSubmitting(false);
    }
  }

  async function decide(id: string, action: string, remarks: string) {
    setError(null);
    const res = await fetch(apiPath("/api/parking-requests"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action, remarks }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Action failed");
    await load();
  }

  function RequestCard({ r, showUser, mine }: { r: ParkingRequest; showUser?: boolean; mine?: boolean }) {
    const badge = STATUS_BADGE[r.status];
    const cancellable = mine && ["PENDING", "APPROVED"].includes(r.status);
    return (
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{r.slot.name}</span>
              <Badge
                className={
                  r.slot.slotType === "RESERVED"
                    ? "bg-purple-100 text-purple-800 border-purple-300"
                    : "bg-slate-100 text-slate-700 border-slate-300"
                }
              >
                {r.slot.slotType === "RESERVED" ? "Reserved" : "General"}
              </Badge>
              <Badge className={badge.cls}>{badge.label}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {fmtSlotRange(r.date, r.startMin, r.endDate, r.endMin)}
            </p>
            {showUser && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                by <span className="font-medium">{r.user.name}</span> ({r.user.username})
              </p>
            )}
            <p className="mt-1.5 text-sm">
              Vehicle: <span className="font-medium uppercase">{r.vehicleNo}</span>
            </p>
            {r.purpose && <p className="mt-0.5 text-sm text-muted-foreground">{r.purpose}</p>}
            {r.remarks && (
              <p className="mt-1.5 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                <span className="font-medium">Remarks:</span> {r.remarks}
              </p>
            )}
            {r.decidedBy && (
              <p className="mt-1 text-xs text-muted-foreground">
                {r.status === "COMPLETED" ? "Completed" : "Decided"} by {r.decidedBy.name} ·{" "}
                {fmtIstDateTime(r.decidedAt)}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {cancellable && (
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  if (!window.confirm("Cancel this parking request?")) return;
                  try {
                    await decide(r.id, "cancel", "Cancelled by requester");
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Action failed");
                  }
                }}
              >
                Cancel
              </Button>
            )}
            {canDecide && !mine && r.status === "PENDING" && (
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  onClick={async () => {
                    const remarks = window.prompt("Remarks (optional):", "") ?? "";
                    try {
                      await decide(r.id, "approve", remarks);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "Action failed");
                    }
                  }}
                >
                  <CheckCircle2 className="mr-1 h-4 w-4" /> Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    const remarks = window.prompt("Reason for rejection (optional):", "") ?? "";
                    try {
                      await decide(r.id, "reject", remarks);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "Action failed");
                    }
                  }}
                >
                  <XCircle className="mr-1 h-4 w-4" /> Reject
                </Button>
              </div>
            )}
            {canDecide && !mine && r.status === "APPROVED" && (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await decide(r.id, "complete", "");
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Action failed");
                  }
                }}
              >
                <CheckCircle2 className="mr-1 h-4 w-4" /> Complete
              </Button>
            )}
          </div>
        </div>
      </Card>
    );
  }

  if (loading && slots.length === 0) {
    return (
      <div className="flex items-center gap-2 py-10 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading parking slots…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {success && (
        <div className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700">{success}</div>
      )}

      <Tabs defaultValue="new">
        <TabsList className="flex-wrap">
          <TabsTrigger value="new">New request</TabsTrigger>
          <TabsTrigger value="mine">My requests ({myRequests.length})</TabsTrigger>
          {canDecide && <TabsTrigger value="all">All requests ({allRequests.length})</TabsTrigger>}
        </TabsList>

        <TabsContent value="new" className="grid gap-4 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ParkingSquare className="h-4 w-4" /> Request a parking slot
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="p-slot">Parking slot</Label>
                <Select value={slotId} onValueChange={setSlotId}>
                  <SelectTrigger id="p-slot" className="w-full">
                    <SelectValue placeholder="Select a slot" />
                  </SelectTrigger>
                  <SelectContent>
                    {slots.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                        {s.area ? ` · ${s.area}` : ""}
                        {s.slotType === "RESERVED" ? " (reserved)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="p-vehicle">Vehicle registration number</Label>
                <Input
                  id="p-vehicle"
                  value={vehicleNo}
                  placeholder="e.g. AP31 XX 1234"
                  className="uppercase"
                  onChange={(e) => setVehicleNo(e.target.value.toUpperCase())}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="p-date">Date (IST)</Label>
                <Input id="p-date" type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="p-start">From (IST)</Label>
                  <Select value={startMin} onValueChange={setStartMin}>
                    <SelectTrigger id="p-start" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {TIMES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-end">To (IST)</Label>
                  <Select value={endMin} onValueChange={setEndMin}>
                    <SelectTrigger id="p-end" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {TIMES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="p-purpose">Purpose / notes (optional)</Label>
                <Textarea
                  id="p-purpose"
                  value={purpose}
                  rows={2}
                  placeholder="e.g. Official vehicle for the day"
                  onChange={(e) => setPurpose(e.target.value)}
                />
              </div>

              <Button onClick={submitRequest} disabled={submitting || !slotId}>
                {submitting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
                Submit request
              </Button>
            </CardContent>
          </Card>

          <div className="lg:col-span-2">
            <h3 className="mb-2 text-sm font-semibold">Parking slots</h3>
            <div className="space-y-2">
              {slots.map((s) => (
                <Card key={s.id} className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{s.name}</p>
                      {s.area && <p className="text-xs text-muted-foreground">{s.area}</p>}
                      {s.notes && <p className="mt-0.5 text-xs text-muted-foreground">{s.notes}</p>}
                    </div>
                    <Badge
                      className={
                        s.slotType === "RESERVED"
                          ? "bg-purple-100 text-purple-800 border-purple-300"
                          : "bg-slate-100 text-slate-700 border-slate-300"
                      }
                    >
                      {s.slotType === "RESERVED" ? "Reserved" : "General"}
                    </Badge>
                  </div>
                </Card>
              ))}
              {slots.length === 0 && <p className="text-sm text-muted-foreground">No parking slots registered yet.</p>}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="mine" className="space-y-2">
          {myRequests.length === 0 ? (
            <p className="text-sm text-muted-foreground">You have not made any parking requests yet.</p>
          ) : (
            myRequests.map((r) => <RequestCard key={r.id} r={r} mine />)
          )}
        </TabsContent>

        {canDecide && (
          <TabsContent value="all" className="space-y-2">
            {allRequests.length === 0 ? (
              <p className="text-sm text-muted-foreground">No parking requests yet.</p>
            ) : (
              allRequests.map((r) => <RequestCard key={r.id} r={r} showUser />)
            )}
          </TabsContent>
        )}
      </Tabs>

      <div className="flex items-center gap-2">
        <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />
        <button onClick={load} className="text-sm text-muted-foreground hover:text-foreground">
          Refresh
        </button>
      </div>
    </div>
  );
}
