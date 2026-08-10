"use client";
import { apiPath } from "iipe-common-ui";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { fmtIstDateTime, fmtSlotRange } from "@/lib/ist";
import { PRIMARY_ROLE_LABELS } from "@/lib/labels";

const PRIMARY_ROLES = ["STAFF_TEACHING", "STAFF_NON_TEACHING", "STUDENT", "SCHOLAR", "GUEST"];

type Building = {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  location: string | null;
  order: number;
  active: boolean;
  facilities: { id: string; name: string }[];
};

type Facility = {
  id: string;
  name: string;
  description: string | null;
  capacity: number | null;
  allowedRoles: string[];
  active: boolean;
  building: { id: string; name: string };
};

type LocalUser = {
  id: string;
  username: string;
  name: string;
  email: string | null;
  primaryRole: string | null;
  role: string;
  isApprover: boolean;
  isPoc: boolean;
};

type AdminBooking = {
  id: string;
  type: "SELF" | "ON_BEHALF" | "LONG";
  status: "CONFIRMED" | "CANCELLED";
  date: string;
  endDate: string;
  startMin: number;
  endMin: number;
  purpose: string | null;
  pdf: boolean;
  facility: { name: string; building: { name: string } };
  user: { name: string; username: string };
  forUser: { name: string; username: string } | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  cancelledBy: { name: string; username: string } | null;
};

export function AdminClient({ isAdmin }: { isAdmin: boolean }) {
  const [error, setError] = useState<string | null>(null);

  if (!isAdmin) {
    return (
      <Card className="p-6">
        <h2 className="text-lg font-semibold">Administrator access required</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Only an app administrator can manage buildings, facilities, user designations and
          bookings. Please contact the app administrator if you believe this is a mistake.
        </p>
      </Card>
    );
  }

  return (
    <div>
      {error && <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <Tabs defaultValue="buildings">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="buildings">Buildings</TabsTrigger>
          <TabsTrigger value="facilities">Facilities</TabsTrigger>
          <TabsTrigger value="users">Users &amp; designations</TabsTrigger>
          <TabsTrigger value="bookings">All bookings</TabsTrigger>
        </TabsList>
        <TabsContent value="buildings"><BuildingsTab onError={setError} /></TabsContent>
        <TabsContent value="facilities"><FacilitiesTab onError={setError} /></TabsContent>
        <TabsContent value="users"><UsersTab onError={setError} /></TabsContent>
        <TabsContent value="bookings"><BookingsTab onError={setError} /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ------------------------------- Buildings ------------------------------- */

function BuildingsTab({ onError }: { onError: (s: string | null) => void }) {
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");

  async function load() {
    const res = await fetch(apiPath("/api/buildings"), { cache: "no-store" });
    const data = await res.json();
    if (res.ok) setBuildings(data.buildings);
  }
  useEffect(() => {
    void load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch(apiPath("/api/buildings"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, code: code.trim() || null, description: description.trim() || null, location: location.trim() || null }),
    });
    const data = await res.json();
    if (!res.ok) return onError(data.error ?? "Could not create building");
    setName(""); setCode(""); setDescription(""); setLocation("");
    onError(null);
    await load();
  }

  async function deactivate(b: Building) {
    const res = await fetch(apiPath("/api/buildings"), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: b.id, active: false }),
    });
    const data = await res.json();
    if (!res.ok) return onError(data.error ?? "Could not deactivate building");
    onError(null);
    await load();
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardContent className="p-5">
          <h3 className="mb-3 font-semibold">Add a building</h3>
          <form onSubmit={create} className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>Name *</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Hostel Block" />
              </div>
              <div className="grid gap-1.5">
                <Label>Code</Label>
                <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. HB" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>Description</Label>
              <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Location</Label>
              <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Main Campus, Block A" />
            </div>
            <div><Button type="submit">Add building</Button></div>
          </form>
        </CardContent>
      </Card>

      {buildings.map((b) => (
        <Card key={b.id}>
          <CardContent className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-semibold">{b.name} {b.code ? `(${b.code})` : ""}</h3>
                <p className="text-sm text-muted-foreground">
                  {b.facilities.length} facilities · {b.location ?? "no location"}
                </p>
                {b.description && <p className="mt-1 text-sm text-muted-foreground">{b.description}</p>}
              </div>
              <Button variant="outline" size="sm" className="text-red-600" onClick={() => deactivate(b)}>
                Deactivate
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* ------------------------------ Facilities ------------------------------- */

function FacilitiesTab({ onError }: { onError: (s: string | null) => void }) {
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [buildingId, setBuildingId] = useState("");
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [capacity, setCapacity] = useState("");
  const [allowedRoles, setAllowedRoles] = useState<string[]>([]);

  async function loadBuildings() {
    const res = await fetch(apiPath("/api/buildings"), { cache: "no-store" });
    const data = await res.json();
    if (res.ok) {
      setBuildings(data.buildings);
      if (data.buildings.length > 0) setBuildingId((prev) => prev || data.buildings[0].id);
    }
  }
  async function loadFacilities(bid: string) {
    if (!bid) return;
    const res = await fetch(apiPath(`/api/facilities?buildingId=${bid}`), { cache: "no-store" });
    const data = await res.json();
    if (res.ok) setFacilities(data.facilities);
  }
  useEffect(() => {
    void loadBuildings();
  }, []);
  useEffect(() => {
    if (buildingId) void loadFacilities(buildingId);
  }, [buildingId]);

  function toggleRole(r: string) {
    setAllowedRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch(apiPath("/api/facilities"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ buildingId, name, description: description.trim() || null, capacity: capacity ? Number(capacity) : null, allowedRoles }),
    });
    const data = await res.json();
    if (!res.ok) return onError(data.error ?? "Could not create facility");
    setName(""); setDescription(""); setCapacity(""); setAllowedRoles([]);
    onError(null);
    await loadFacilities(buildingId);
  }

  async function deactivate(f: Facility) {
    const res = await fetch(apiPath("/api/facilities"), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: f.id, active: false }),
    });
    const data = await res.json();
    if (!res.ok) return onError(data.error ?? "Could not deactivate facility");
    onError(null);
    await loadFacilities(buildingId);
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardContent className="p-5">
          <h3 className="mb-3 font-semibold">Add a facility</h3>
          <form onSubmit={create} className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <Label>Building *</Label>
                <Select value={buildingId} onValueChange={setBuildingId}>
                  <SelectTrigger><SelectValue placeholder="Select building" /></SelectTrigger>
                  <SelectContent>
                    {buildings.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Facility name *</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="grid gap-1.5">
                <Label>Capacity</Label>
                <Input type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>Description</Label>
              <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Who may book (primary roles — none selected means everyone)</Label>
              <div className="flex flex-wrap gap-4">
                {PRIMARY_ROLES.map((r) => (
                  <label key={r} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={allowedRoles.includes(r)} onCheckedChange={() => toggleRole(r)} />
                    {PRIMARY_ROLE_LABELS[r] ?? r}
                  </label>
                ))}
              </div>
            </div>
            <div><Button type="submit">Add facility</Button></div>
          </form>
        </CardContent>
      </Card>

      {facilities.map((f) => (
        <Card key={f.id}>
          <CardContent className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold">{f.name}</h3>
                <p className="text-sm text-muted-foreground">
                  {f.building.name}{f.capacity ? ` · capacity ${f.capacity}` : ""}
                </p>
                {f.description && <p className="mt-1 text-sm text-muted-foreground">{f.description}</p>}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {f.allowedRoles.length === 0 ? (
                    <Badge>Open to all</Badge>
                  ) : (
                    f.allowedRoles.map((r) => <Badge key={r} variant="secondary">{PRIMARY_ROLE_LABELS[r] ?? r}</Badge>)
                  )}
                </div>
              </div>
              <Button variant="outline" size="sm" className="text-red-600" onClick={() => deactivate(f)}>
                Deactivate
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* --------------------------------- Users --------------------------------- */

function UsersTab({ onError }: { onError: (s: string | null) => void }) {
  const [users, setUsers] = useState<LocalUser[]>([]);

  async function load() {
    const res = await fetch(apiPath("/api/users"), { cache: "no-store" });
    const data = await res.json();
    if (res.ok) setUsers(data.users);
  }
  useEffect(() => {
    void load();
  }, []);

  async function patch(u: LocalUser, fields: Record<string, unknown>) {
    const res = await fetch(apiPath("/api/users"), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: u.id, ...fields }),
    });
    const data = await res.json();
    if (!res.ok) return onError(data.error ?? "Could not update user");
    onError(null);
    await load();
  }

  if (users.length === 0) {
    return (
      <p className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading users…
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      {users.map((u) => (
        <Card key={u.id}>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{u.name} <span className="font-normal text-muted-foreground">@{u.username}</span></div>
                <div className="text-sm text-muted-foreground">
                  {PRIMARY_ROLE_LABELS[u.primaryRole ?? ""] ?? u.primaryRole ?? "No primary role"} · {u.email ?? ""}
                </div>
              </div>
              <Select value={u.role} onValueChange={(v) => patch(u, { role: v })}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="USER">User</SelectItem>
                  <SelectItem value="ADMIN">App Admin</SelectItem>
                </SelectContent>
              </Select>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={u.isApprover} onCheckedChange={(v) => patch(u, { isApprover: v === true })} /> Approver
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={u.isPoc} onCheckedChange={(v) => patch(u, { isPoc: v === true })} /> POC
              </label>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* -------------------------------- Bookings -------------------------------- */

function BookingsTab({ onError }: { onError: (s: string | null) => void }) {
  const [bookings, setBookings] = useState<AdminBooking[]>([]);
  const [statusFilter, setStatusFilter] = useState("ALL");

  const load = useCallback(async () => {
    const res = await fetch(apiPath("/api/bookings?all=1"), { cache: "no-store" });
    const data = await res.json();
    if (res.ok) setBookings(data.bookings);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function cancel(id: string) {
    const reason = window.prompt("Reason for cancelling (optional):") ?? null;
    if (reason === null) return; // user dismissed the prompt
    const res = await fetch(apiPath(`/api/bookings?id=${id}&reason=${encodeURIComponent(reason)}`), { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) return onError(data.error ?? "Could not cancel");
    onError(null);
    await load();
  }

  const visible = statusFilter === "ALL" ? bookings : bookings.filter((b) => b.status === statusFilter);

  if (bookings.length === 0) return <p className="text-muted-foreground">No bookings yet.</p>;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Status:</span>
        {["ALL", "CONFIRMED", "CANCELLED"].map((st) => (
          <Button
            key={st}
            size="sm"
            variant={statusFilter === st ? "default" : "outline"}
            onClick={() => setStatusFilter(st)}
          >
            {st === "ALL" ? "All" : st === "CONFIRMED" ? "Confirmed" : "Cancelled"}
          </Button>
        ))}
      </div>
      {visible.length === 0 && <p className="text-muted-foreground">Nothing here.</p>}
      {visible.map((b) => (
        <Card key={b.id}>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{b.facility.building.name} — {b.facility.name}</div>
                <div className="text-sm text-muted-foreground">
                  {fmtSlotRange(b.date, b.startMin, b.endDate, b.endMin)} · {b.user.name} (@{b.user.username})
                  {b.forUser ? ` → for ${b.forUser.name}` : ""}
                </div>
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
                  {b.status === "CANCELLED" ? " · Cancelled" : ""}
                </Badge>
                <div className="flex gap-2">
                  {b.pdf && (
                    <Button variant="outline" size="sm" asChild>
                      <a href={apiPath(`/api/bookings/${b.id}/pdf`)} target="_blank" rel="noreferrer">PDF</a>
                    </Button>
                  )}
                  {b.status === "CONFIRMED" && (
                    <Button variant="outline" size="sm" className="text-red-600" onClick={() => cancel(b.id)}>
                      Cancel
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
