"use client";
import { apiPath } from "sanapp-common-ui";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Pencil, Plus, Trash2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
  active: boolean;
  _count?: { requests: number };
};

type ParkingSlot = {
  id: string;
  name: string;
  area: string | null;
  slotType: "RESERVED" | "GENERAL";
  notes: string | null;
  active: boolean;
};

type Req = {
  id: string;
  date: string;
  endDate: string;
  startMin: number;
  endMin: number;
  status: "PENDING" | "APPROVED" | "REJECTED" | "COMPLETED" | "CANCELLED";
  remarks: string | null;
  decidedAt: string | null;
  createdAt: string;
  user: { id: string; username: string; name: string };
  decidedBy: { id: string; username: string; name: string } | null;
};

type VehicleRequest = Req & {
  purpose: string;
  destination: string | null;
  passengers: number | null;
  vehicle: { id: string; name: string; type: string; registrationNo: string };
};

type ParkingRequest = Req & {
  vehicleNo: string;
  purpose: string | null;
  slot: { id: string; name: string; area: string | null; slotType: string };
};

const V_STATUSES = ["AVAILABLE", "IN_USE", "MAINTENANCE", "RETIRED"] as const;
const V_STATUS_LABEL: Record<string, string> = {
  AVAILABLE: "Available",
  IN_USE: "In use",
  MAINTENANCE: "Maintenance",
  RETIRED: "Retired",
};
const REQ_BADGE: Record<Req["status"], { label: string; cls: string }> = {
  PENDING: { label: "Pending", cls: "bg-amber-100 text-amber-800 border-amber-300" },
  APPROVED: { label: "Approved", cls: "bg-green-100 text-green-800 border-green-300" },
  REJECTED: { label: "Rejected", cls: "bg-red-100 text-red-800 border-red-300" },
  COMPLETED: { label: "Completed", cls: "bg-blue-100 text-blue-800 border-blue-300" },
  CANCELLED: { label: "Cancelled", cls: "bg-slate-200 text-slate-700 border-slate-300" },
};

export function AdminLogisticsTab({ onError }: { onError: (s: string | null) => void }) {
  return (
    <Tabs defaultValue="vehicles">
      <TabsList className="flex-wrap h-auto">
        <TabsTrigger value="vehicles">Vehicles</TabsTrigger>
        <TabsTrigger value="parking">Parking slots</TabsTrigger>
        <TabsTrigger value="vreq">Vehicle requests</TabsTrigger>
        <TabsTrigger value="preq">Parking requests</TabsTrigger>
      </TabsList>
      <TabsContent value="vehicles"><VehiclesTab onError={onError} /></TabsContent>
      <TabsContent value="parking"><ParkingTab onError={onError} /></TabsContent>
      <TabsContent value="vreq"><VehicleRequestsTab onError={onError} /></TabsContent>
      <TabsContent value="preq"><ParkingRequestsTab onError={onError} /></TabsContent>
    </Tabs>
  );
}

/* ------------------------------- Vehicles ------------------------------- */

function VehiclesTab({ onError }: { onError: (s: string | null) => void }) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [reg, setReg] = useState("");
  const [capacity, setCapacity] = useState("");
  const [driverName, setDriverName] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(apiPath("/api/vehicles"), { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setVehicles(data.vehicles);
      else onError(data.error ?? "Failed to load vehicles");
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to load vehicles");
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  function resetForm() {
    setName("");
    setType("");
    setReg("");
    setCapacity("");
    setDriverName("");
    setDriverPhone("");
    setNotes("");
    setEditing(null);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !type.trim() || !reg.trim()) {
      onError("Name, type and registration number are required");
      return;
    }
    const body: Record<string, unknown> = {
      name,
      type,
      registrationNo: reg,
      capacity: capacity === "" ? null : Number(capacity),
      driverName: driverName.trim() || null,
      driverPhone: driverPhone.trim() || null,
      notes: notes.trim() || null,
    };
    const res = await fetch(apiPath("/api/vehicles"), {
      method: editing ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(editing ? { ...body, id: editing } : body),
    });
    const data = await res.json();
    if (!res.ok) {
      onError(data.error ?? "Failed to save vehicle");
      return;
    }
    resetForm();
    await load();
  }

  async function updateStatus(v: Vehicle, status: string) {
    const res = await fetch(apiPath("/api/vehicles"), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: v.id, status }),
    });
    const data = await res.json();
    if (!res.ok) onError(data.error ?? "Failed to update vehicle");
    else await load();
  }

  async function remove(v: Vehicle) {
    if (!window.confirm(`Remove vehicle "${v.name}" (${v.registrationNo})?`)) return;
    const res = await fetch(apiPath(`/api/vehicles?id=${v.id}`), { method: "DELETE" });
    if (!res.ok) onError("Failed to remove vehicle");
    else await load();
  }

  if (loading && vehicles.length === 0) {
    return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold">{editing ? "Edit vehicle" : "Add vehicle"}</h3>
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Toyota Innova" />
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Input value={type} onChange={(e) => setType(e.target.value)} placeholder="Car / Van / Bus" />
          </div>
          <div className="space-y-1.5">
            <Label>Registration no.</Label>
            <Input value={reg} onChange={(e) => setReg(e.target.value)} placeholder="AP31 XX 1234" className="uppercase" />
          </div>
          <div className="space-y-1.5">
            <Label>Capacity (optional)</Label>
            <Input type="number" min={1} max={100} value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="e.g. 6" />
          </div>
          <div className="space-y-1.5">
            <Label>Driver name (optional)</Label>
            <Input value={driverName} onChange={(e) => setDriverName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Driver phone (optional)</Label>
            <Input value={driverPhone} onChange={(e) => setDriverPhone(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-3">
            <Label>Notes (optional)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="flex items-center gap-2 sm:col-span-3">
            <Button type="submit" size="sm">
              <Plus className="mr-1 h-4 w-4" /> {editing ? "Save changes" : "Add vehicle"}
            </Button>
            {editing && (
              <Button type="button" variant="outline" size="sm" onClick={resetForm}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </Card>

      <div className="space-y-2">
        {vehicles.map((v) => (
          <Card key={v.id} className="p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{v.name}</span>
                  <Badge className={v.status === "AVAILABLE" ? "bg-green-100 text-green-800 border-green-300" : v.status === "MAINTENANCE" ? "bg-amber-100 text-amber-800 border-amber-300" : "bg-slate-200 text-slate-700 border-slate-300"}>
                    {V_STATUS_LABEL[v.status]}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {v.type} · {v.registrationNo}
                  {v.capacity ? ` · ${v.capacity} seats` : ""}
                  {v.driverName ? ` · Driver: ${v.driverName}` : ""}
                </p>
                {v.notes && <p className="mt-0.5 text-xs text-muted-foreground">{v.notes}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {v.status === "AVAILABLE" && (
                  <Button size="sm" variant="outline" onClick={() => updateStatus(v, "IN_USE")}>Mark in use</Button>
                )}
                {v.status === "IN_USE" && (
                  <Button size="sm" variant="outline" onClick={() => updateStatus(v, "AVAILABLE")}>Mark available</Button>
                )}
                {v.status !== "MAINTENANCE" && (
                  <Button size="sm" variant="outline" onClick={() => updateStatus(v, "MAINTENANCE")}>Maintenance</Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => {
                  setEditing(v.id);
                  setName(v.name); setType(v.type); setReg(v.registrationNo);
                  setCapacity(v.capacity ? String(v.capacity) : "");
                  setDriverName(v.driverName ?? ""); setDriverPhone(v.driverPhone ?? "");
                  setNotes(v.notes ?? "");
                }}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="ghost" className="text-red-600" onClick={() => remove(v)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </Card>
        ))}
        {vehicles.length === 0 && <p className="text-sm text-muted-foreground">No vehicles yet. Add the first one above.</p>}
      </div>
    </div>
  );
}

/* ----------------------------- Parking slots ----------------------------- */

function ParkingTab({ onError }: { onError: (s: string | null) => void }) {
  const [slots, setSlots] = useState<ParkingSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [area, setArea] = useState("");
  const [slotType, setSlotType] = useState<"GENERAL" | "RESERVED">("GENERAL");
  const [notes, setNotes] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(apiPath("/api/parking-slots"), { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setSlots(data.slots);
      else onError(data.error ?? "Failed to load parking slots");
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to load parking slots");
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  function resetForm() {
    setName("");
    setArea("");
    setSlotType("GENERAL");
    setNotes("");
    setEditing(null);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      onError("Slot name is required");
      return;
    }
    const body: Record<string, unknown> = {
      name,
      area: area.trim() || null,
      slotType,
      notes: notes.trim() || null,
    };
    const res = await fetch(apiPath("/api/parking-slots"), {
      method: editing ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(editing ? { ...body, id: editing } : body),
    });
    const data = await res.json();
    if (!res.ok) {
      onError(data.error ?? "Failed to save parking slot");
      return;
    }
    resetForm();
    await load();
  }

  async function remove(s: ParkingSlot) {
    if (!window.confirm(`Remove parking slot "${s.name}"?`)) return;
    const res = await fetch(apiPath(`/api/parking-slots?id=${s.id}`), { method: "DELETE" });
    if (!res.ok) onError("Failed to remove parking slot");
    else await load();
  }

  if (loading && slots.length === 0) {
    return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold">{editing ? "Edit parking slot" : "Add parking slot"}</h3>
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Slot name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Block A — P1" />
          </div>
          <div className="space-y-1.5">
            <Label>Area / location (optional)</Label>
            <Input value={area} onChange={(e) => setArea(e.target.value)} placeholder="e.g. Main Campus" />
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={slotType} onValueChange={(v) => setSlotType(v as "GENERAL" | "RESERVED")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="GENERAL">General</SelectItem>
                <SelectItem value="RESERVED">Reserved</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Notes (optional)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="flex items-center gap-2 sm:col-span-2">
            <Button type="submit" size="sm">
              <Plus className="mr-1 h-4 w-4" /> {editing ? "Save changes" : "Add slot"}
            </Button>
            {editing && (
              <Button type="button" variant="outline" size="sm" onClick={resetForm}>Cancel</Button>
            )}
          </div>
        </form>
      </Card>

      <div className="space-y-2">
        {slots.map((s) => (
          <Card key={s.id} className="p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{s.name}</span>
                  <Badge className={s.slotType === "RESERVED" ? "bg-purple-100 text-purple-800 border-purple-300" : "bg-slate-100 text-slate-700 border-slate-300"}>
                    {s.slotType === "RESERVED" ? "Reserved" : "General"}
                  </Badge>
                </div>
                {s.area && <p className="text-xs text-muted-foreground">{s.area}</p>}
                {s.notes && <p className="mt-0.5 text-xs text-muted-foreground">{s.notes}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => {
                  setEditing(s.id);
                  setName(s.name); setArea(s.area ?? ""); setSlotType(s.slotType); setNotes(s.notes ?? "");
                }}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="ghost" className="text-red-600" onClick={() => remove(s)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </Card>
        ))}
        {slots.length === 0 && <p className="text-sm text-muted-foreground">No parking slots yet. Add the first one above.</p>}
      </div>
    </div>
  );
}

/* --------------------------- Request queues --------------------------- */

function ReqActions({
  r,
  onDecide,
}: {
  r: { status: string };
  onDecide: (action: string) => Promise<void>;
}) {
  if (r.status === "PENDING") {
    return (
      <div className="flex items-center gap-1.5">
        <Button size="sm" onClick={() => onDecide("approve")}>
          <CheckCircle2 className="mr-1 h-4 w-4" /> Approve
        </Button>
        <Button size="sm" variant="outline" onClick={() => onDecide("reject")}>
          <XCircle className="mr-1 h-4 w-4" /> Reject
        </Button>
      </div>
    );
  }
  if (r.status === "APPROVED") {
    return (
      <Button size="sm" variant="outline" onClick={() => onDecide("complete")}>
        <CheckCircle2 className="mr-1 h-4 w-4" /> Complete
      </Button>
    );
  }
  return null;
}

function VehicleRequestsTab({ onError }: { onError: (s: string | null) => void }) {
  const [requests, setRequests] = useState<VehicleRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(apiPath("/api/vehicle-requests?scope=all"), { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setRequests(data.requests);
      else onError(data.error ?? "Failed to load requests");
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to load requests");
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(id: string, action: string) {
    let remarks = "";
    if (action === "reject") remarks = window.prompt("Reason for rejection:", "") ?? "";
    const res = await fetch(apiPath("/api/vehicle-requests"), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, action, remarks }),
    });
    const data = await res.json();
    if (!res.ok) onError(data.error ?? "Action failed");
    else await load();
  }

  if (loading && requests.length === 0) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;

  return (
    <div className="space-y-2">
      {requests.length === 0 && <p className="text-sm text-muted-foreground">No vehicle requests yet.</p>}
      {requests.map((r) => {
        const badge = REQ_BADGE[r.status];
        return (
          <Card key={r.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{r.vehicle.name} ({r.vehicle.registrationNo})</span>
                  <Badge className={badge.cls}>{badge.label}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{fmtSlotRange(r.date, r.startMin, r.endDate, r.endMin)}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  by <span className="font-medium">{r.user.name}</span> ({r.user.username})
                  {r.destination ? ` · → ${r.destination}` : ""}
                  {r.passengers ? ` · ${r.passengers} pax` : ""}
                </p>
                <p className="mt-1.5 text-sm">{r.purpose}</p>
                {r.remarks && (
                  <p className="mt-1.5 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                    <span className="font-medium">Remarks:</span> {r.remarks}
                  </p>
                )}
                {r.decidedBy && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {r.status === "COMPLETED" ? "Completed" : "Decided"} by {r.decidedBy.name} · {fmtIstDateTime(r.decidedAt)}
                  </p>
                )}
              </div>
              <ReqActions r={r} onDecide={(a) => decide(r.id, a)} />
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function ParkingRequestsTab({ onError }: { onError: (s: string | null) => void }) {
  const [requests, setRequests] = useState<ParkingRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(apiPath("/api/parking-requests?scope=all"), { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setRequests(data.requests);
      else onError(data.error ?? "Failed to load requests");
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to load requests");
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(id: string, action: string) {
    let remarks = "";
    if (action === "reject") remarks = window.prompt("Reason for rejection:", "") ?? "";
    const res = await fetch(apiPath("/api/parking-requests"), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, action, remarks }),
    });
    const data = await res.json();
    if (!res.ok) onError(data.error ?? "Action failed");
    else await load();
  }

  if (loading && requests.length === 0) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;

  return (
    <div className="space-y-2">
      {requests.length === 0 && <p className="text-sm text-muted-foreground">No parking requests yet.</p>}
      {requests.map((r) => {
        const badge = REQ_BADGE[r.status];
        return (
          <Card key={r.id} className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{r.slot.name}</span>
                  <Badge className={r.slot.slotType === "RESERVED" ? "bg-purple-100 text-purple-800 border-purple-300" : "bg-slate-100 text-slate-700 border-slate-300"}>
                    {r.slot.slotType === "RESERVED" ? "Reserved" : "General"}
                  </Badge>
                  <Badge className={badge.cls}>{badge.label}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{fmtSlotRange(r.date, r.startMin, r.endDate, r.endMin)}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  by <span className="font-medium">{r.user.name}</span> ({r.user.username}) · Vehicle{" "}
                  <span className="font-medium uppercase">{r.vehicleNo}</span>
                </p>
                {r.purpose && <p className="mt-1.5 text-sm text-muted-foreground">{r.purpose}</p>}
                {r.remarks && (
                  <p className="mt-1.5 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                    <span className="font-medium">Remarks:</span> {r.remarks}
                  </p>
                )}
                {r.decidedBy && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {r.status === "COMPLETED" ? "Completed" : "Decided"} by {r.decidedBy.name} · {fmtIstDateTime(r.decidedAt)}
                  </p>
                )}
              </div>
              <ReqActions r={r} onDecide={(a) => decide(r.id, a)} />
            </div>
          </Card>
        );
      })}
    </div>
  );
}
