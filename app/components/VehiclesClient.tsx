"use client";
import { apiPath } from "sanapp-common-ui";
import { useCallback, useEffect, useState } from "react";
import { Car, CheckCircle2, Loader2, RotateCcw, Send, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { fmtIstDateTime, fmtSlotRange } from "@/lib/ist";

type Vehicle = {
  id: string;
  name: string;
  type: string;
  registrationNo: string;
  capacity: number | null;
  driverName: string | null;
  driverPhone: string | null;
  status: "AVAILABLE" | "IN_USE" | "MAINTENANCE" | "RETIRED";
  notes: string | null;
  _count?: { requests: number };
};

type VehicleRequest = {
  id: string;
  date: string;
  endDate: string;
  startMin: number;
  endMin: number;
  purpose: string;
  destination: string | null;
  passengers: number | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "COMPLETED" | "CANCELLED";
  remarks: string | null;
  decidedAt: string | null;
  createdAt: string;
  vehicle: { id: string; name: string; type: string; registrationNo: string };
  user: { id: string; username: string; name: string };
  decidedBy: { id: string; username: string; name: string } | null;
};

const STATUS_BADGE: Record<VehicleRequest["status"], { label: string; cls: string }> = {
  PENDING: { label: "Pending", cls: "bg-amber-100 text-amber-800 border-amber-300" },
  APPROVED: { label: "Approved", cls: "bg-green-100 text-green-800 border-green-300" },
  REJECTED: { label: "Rejected", cls: "bg-red-100 text-red-800 border-red-300" },
  COMPLETED: { label: "Completed", cls: "bg-blue-100 text-blue-800 border-blue-300" },
  CANCELLED: { label: "Cancelled", cls: "bg-slate-200 text-slate-700 border-slate-300" },
};

const VEHICLE_STATUS_LABEL: Record<Vehicle["status"], string> = {
  AVAILABLE: "Available",
  IN_USE: "In use",
  MAINTENANCE: "Maintenance",
  RETIRED: "Retired",
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

export function VehiclesClient({ today }: { today: string }) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [myRequests, setMyRequests] = useState<VehicleRequest[]>([]);
  const [allRequests, setAllRequests] = useState<VehicleRequest[]>([]);
  const [canDecide, setCanDecide] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New-request form state.
  const [vehicleId, setVehicleId] = useState("");
  const [date, setDate] = useState(today);
  const [startMin, setStartMin] = useState(String(9 * 60));
  const [endMin, setEndMin] = useState(String(10 * 60));
  const [purpose, setPurpose] = useState("");
  const [destination, setDestination] = useState("");
  const [passengers, setPassengers] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [vRes, mineRes, allRes] = await Promise.all([
        fetch(apiPath("/api/vehicles"), { cache: "no-store" }),
        fetch(apiPath("/api/vehicle-requests?scope=mine"), { cache: "no-store" }),
        fetch(apiPath("/api/vehicle-requests?scope=all"), { cache: "no-store" }),
      ]);
      if (!vRes.ok || !mineRes.ok) throw new Error("Failed to load vehicle data");
      const vData = await vRes.json();
      const mineData = await mineRes.json();
      setVehicles(vData.vehicles);
      setMyRequests(mineData.requests);
      setCanDecide(mineData.canDecide === true);
      if (allRes.ok) {
        const allData = await allRes.json();
        setAllRequests(allData.requests);
      }
      if (!vehicleId && vData.vehicles.length > 0) setVehicleId(vData.vehicles[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load vehicle data");
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
    if (!vehicleId) return setError("Select a vehicle");
    setSubmitting(true);
    try {
      const res = await fetch(apiPath("/api/vehicle-requests"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vehicleId,
          date,
          startMin: Number(startMin),
          endMin: Number(endMin),
          purpose,
          destination,
          passengers: passengers ? Number(passengers) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to submit the request");
      setSuccess("Vehicle request submitted — the logistics POC will review it.");
      setPurpose("");
      setDestination("");
      setPassengers("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit the request");
    } finally {
      setSubmitting(false);
    }
  }

  async function decide(id: string, action: string, remarks: string) {
    setError(null);
    const res = await fetch(apiPath("/api/vehicle-requests"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action, remarks }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Action failed");
    await load();
  }

  function RequestCard({ r, showUser, mine }: { r: VehicleRequest; showUser?: boolean; mine?: boolean }) {
    const badge = STATUS_BADGE[r.status];
    const pending = r.status === "PENDING";
    const cancellable = mine && ["PENDING", "APPROVED"].includes(r.status);
    return (
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">
                {r.vehicle.name}{" "}
                <span className="text-xs font-normal text-muted-foreground">({r.vehicle.registrationNo})</span>
              </span>
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
            <p className="mt-1.5 text-sm">{r.purpose}</p>
            {(r.destination || r.passengers) && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {r.destination && `Destination: ${r.destination}`}
                {r.destination && r.passengers ? " · " : ""}
                {r.passengers ? `${r.passengers} passenger${r.passengers === 1 ? "" : "s"}` : ""}
              </p>
            )}
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
                  if (!window.confirm("Cancel this vehicle request?")) return;
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
            {canDecide && !mine && pending && (
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

  if (loading && vehicles.length === 0) {
    return (
      <div className="flex items-center gap-2 py-10 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading vehicles…
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
                <Car className="h-4 w-4" /> Request a vehicle
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="v-vehicle">Vehicle</Label>
                <Select value={vehicleId} onValueChange={setVehicleId}>
                  <SelectTrigger id="v-vehicle" className="w-full">
                    <SelectValue placeholder="Select a vehicle" />
                  </SelectTrigger>
                  <SelectContent>
                    {vehicles
                      .filter((v) => v.status !== "RETIRED")
                      .map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.name} · {v.registrationNo}
                          {v.status === "MAINTENANCE" ? " (maintenance)" : ""}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="v-date">Date (IST)</Label>
                  <Input id="v-date" type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="v-passengers">Passengers (optional)</Label>
                  <Input
                    id="v-passengers"
                    type="number"
                    min={1}
                    max={100}
                    value={passengers}
                    placeholder="e.g. 4"
                    onChange={(e) => setPassengers(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="v-start">From (IST)</Label>
                  <Select value={startMin} onValueChange={setStartMin}>
                    <SelectTrigger id="v-start" className="w-full">
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
                  <Label htmlFor="v-end">To (IST)</Label>
                  <Select value={endMin} onValueChange={setEndMin}>
                    <SelectTrigger id="v-end" className="w-full">
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
                <Label htmlFor="v-dest">Destination (optional)</Label>
                <Input
                  id="v-dest"
                  value={destination}
                  placeholder="e.g. Visakhapatnam Railway Station"
                  onChange={(e) => setDestination(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="v-purpose">Purpose</Label>
                <Textarea
                  id="v-purpose"
                  value={purpose}
                  rows={3}
                  placeholder="Describe the purpose of the trip"
                  onChange={(e) => setPurpose(e.target.value)}
                />
              </div>

              <Button onClick={submitRequest} disabled={submitting || !vehicleId}>
                {submitting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
                Submit request
              </Button>
            </CardContent>
          </Card>

          <div className="lg:col-span-2">
            <h3 className="mb-2 text-sm font-semibold">Fleet</h3>
            <div className="space-y-2">
              {vehicles.map((v) => (
                <Card key={v.id} className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{v.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {v.type} · {v.registrationNo}
                        {v.capacity ? ` · ${v.capacity} seats` : ""}
                      </p>
                      {(v.driverName || v.driverPhone) && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {v.driverName ? `Driver: ${v.driverName}` : ""}
                          {v.driverName && v.driverPhone ? " · " : ""}
                          {v.driverPhone ? v.driverPhone : ""}
                        </p>
                      )}
                    </div>
                    <Badge
                      className={
                        v.status === "AVAILABLE"
                          ? "bg-green-100 text-green-800 border-green-300"
                          : v.status === "MAINTENANCE"
                            ? "bg-amber-100 text-amber-800 border-amber-300"
                            : "bg-slate-200 text-slate-700 border-slate-300"
                      }
                    >
                      {VEHICLE_STATUS_LABEL[v.status]}
                    </Badge>
                  </div>
                </Card>
              ))}
              {vehicles.length === 0 && <p className="text-sm text-muted-foreground">No vehicles registered yet.</p>}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="mine" className="space-y-2">
          {myRequests.length === 0 ? (
            <p className="text-sm text-muted-foreground">You have not made any vehicle requests yet.</p>
          ) : (
            myRequests.map((r) => <RequestCard key={r.id} r={r} mine />)
          )}
        </TabsContent>

        {canDecide && (
          <TabsContent value="all" className="space-y-2">
            {allRequests.length === 0 ? (
              <p className="text-sm text-muted-foreground">No vehicle requests yet.</p>
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
