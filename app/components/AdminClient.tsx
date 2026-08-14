"use client";
import { apiPath } from "sanapp-common-ui";
import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { AdminBookingsTab } from "./AdminBookingsTab";
import { capLabel } from "@/lib/limits";
import { PRIMARY_ROLE_LABELS } from "@/lib/labels";

const PRIMARY_ROLES = ["STAFF_TEACHING", "STAFF_NON_TEACHING", "STUDENT", "SCHOLAR", "GUEST"];

type RoleLimit = { role: string; maxMinutes: number };

type Building = {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  location: string | null;
  order: number;
  active: boolean;
  maxMinutes: number | null;
  facilities: { id: string; name: string }[];
};

type Facility = {
  id: string;
  name: string;
  description: string | null;
  capacity: number | null;
  allowedRoles: string[];
  maxMinutes: number | null;
  roleLimits: RoleLimit[];
  active: boolean;
  building: { id: string; name: string; maxMinutes: number | null };
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
  facility: { id: string; name: string; building: { name: string } };
  user: { name: string; username: string };
  forUser: { name: string; username: string } | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  cancelledBy: { name: string; username: string } | null;
};

export function AdminClient({ isAdmin, today }: { isAdmin: boolean; today: string }) {
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
        <TabsContent value="bookings"><AdminBookingsTab onError={setError} today={today} /></TabsContent>
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
  const [maxMinutes, setMaxMinutes] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editMax, setEditMax] = useState("");

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
      body: JSON.stringify({
        name,
        code: code.trim() || null,
        description: description.trim() || null,
        location: location.trim() || null,
        maxMinutes: maxMinutes === "" ? null : Number(maxMinutes),
      }),
    });
    const data = await res.json();
    if (!res.ok) return onError(data.error ?? "Could not create building");
    setName(""); setCode(""); setDescription(""); setLocation(""); setMaxMinutes("");
    onError(null);
    await load();
  }

  async function patch(id: string, fields: Record<string, unknown>) {
    const res = await fetch(apiPath("/api/buildings"), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, ...fields }),
    });
    const data = await res.json();
    if (!res.ok) return onError(data.error ?? "Could not update building");
    onError(null);
    await load();
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardContent className="p-5">
          <h3 className="mb-3 font-semibold">Add a building</h3>
          <form onSubmit={create} className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <Label>Name *</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Hostel Block" />
              </div>
              <div className="grid gap-1.5">
                <Label>Code</Label>
                <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. HB" />
              </div>
              <div className="grid gap-1.5">
                <Label>Default max booking (minutes)</Label>
                <Input type="number" min={15} step={15} value={maxMinutes} onChange={(e) => setMaxMinutes(e.target.value)} placeholder="blank = 3 h (180)" />
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
                <p className="mt-1 text-xs font-medium text-primary">
                  Max {b.maxMinutes ? capLabel(b.maxMinutes) : "3 h (default)"} per booking per facility
                </p>
                {b.description && <p className="mt-1 text-sm text-muted-foreground">{b.description}</p>}
                {editing === b.id && (
                  <form
                    className="mt-3 flex flex-wrap items-end gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void patch(b.id, { maxMinutes: editMax === "" ? null : Number(editMax) });
                      setEditing(null);
                    }}
                  >
                    <div className="grid gap-1">
                      <Label className="text-xs">Default max booking (minutes)</Label>
                      <Input type="number" min={15} step={15} className="w-44" value={editMax} onChange={(e) => setEditMax(e.target.value)} placeholder="blank = 3 h (180)" />
                    </div>
                    <Button size="sm">Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                  </form>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditing(editing === b.id ? null : b.id);
                    setEditMax(b.maxMinutes ? String(b.maxMinutes) : "");
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" /> Duration
                </Button>
                <Button variant="outline" size="sm" className="text-red-600" onClick={() => patch(b.id, { active: false })}>
                  Deactivate
                </Button>
              </div>
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
  const [maxMinutes, setMaxMinutes] = useState("");
  const [roleLimits, setRoleLimits] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Record<string, unknown>>({});

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
      body: JSON.stringify({
        buildingId,
        name,
        description: description.trim() || null,
        capacity: capacity ? Number(capacity) : null,
        allowedRoles,
        maxMinutes: maxMinutes === "" ? null : Number(maxMinutes),
        roleLimits: Object.entries(roleLimits)
          .filter(([, v]) => v !== "" && Number(v) > 0)
          .map(([role, v]) => ({ role, maxMinutes: Number(v) })),
      }),
    });
    const data = await res.json();
    if (!res.ok) return onError(data.error ?? "Could not create facility");
    setName(""); setDescription(""); setCapacity(""); setAllowedRoles([]); setMaxMinutes(""); setRoleLimits({});
    onError(null);
    await loadFacilities(buildingId);
  }

  async function patchFacility(id: string, fields: Record<string, unknown>) {
    const res = await fetch(apiPath("/api/facilities"), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, ...fields }),
    });
    const data = await res.json();
    if (!res.ok) return onError(data.error ?? "Could not update facility");
    onError(null);
    await loadFacilities(buildingId);
  }

  function startEdit(f: Facility) {
    setEditingId(f.id);
    setEditForm({
      name: f.name,
      description: f.description ?? "",
      capacity: f.capacity ? String(f.capacity) : "",
      allowedRoles: f.allowedRoles,
      maxMinutes: f.maxMinutes ? String(f.maxMinutes) : "",
      roleLimits: Object.fromEntries(f.roleLimits.map((r) => [r.role, String(r.maxMinutes)])),
    });
  }

  function saveEdit(f: Facility) {
    void patchFacility(f.id, {
      name: String(editForm.name ?? f.name).trim() || f.name,
      description: String(editForm.description ?? "").trim() || null,
      capacity: editForm.capacity === "" ? null : Number(editForm.capacity),
      allowedRoles: Array.isArray(editForm.allowedRoles) ? editForm.allowedRoles : f.allowedRoles,
      maxMinutes: editForm.maxMinutes === "" || editForm.maxMinutes === null ? null : Number(editForm.maxMinutes),
      roleLimits: Object.entries((editForm.roleLimits as Record<string, string>) ?? {})
        .filter(([, v]) => v !== "" && Number(v) > 0)
        .map(([role, v]) => ({ role, maxMinutes: Number(v) })),
    });
    setEditingId(null);
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardContent className="p-5">
          <h3 className="mb-3 font-semibold">Add a facility</h3>
          <form onSubmit={create} className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-4">
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
              <div className="grid gap-1.5">
                <Label>Max booking (minutes)</Label>
                <Input type="number" min={15} step={15} value={maxMinutes} onChange={(e) => setMaxMinutes(e.target.value)} placeholder="blank = building/3 h" />
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
            <div className="grid gap-1.5">
              <Label>Per-role max duration (minutes) — optional, overrides the facility max</Label>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {PRIMARY_ROLES.map((r) => (
                  <div key={r} className="grid gap-1">
                    <Label className="text-xs">{PRIMARY_ROLE_LABELS[r] ?? r}</Label>
                    <Input type="number" min={15} step={15} placeholder="blank = no cap"
                      value={roleLimits[r] ?? ""}
                      onChange={(e) => setRoleLimits((p) => ({ ...p, [r]: e.target.value }))} />
                  </div>
                ))}
              </div>
            </div>
            <div><Button type="submit">Add facility</Button></div>
          </form>
        </CardContent>
      </Card>

      {facilities.map((f) => {
        const effMax = f.maxMinutes ?? f.building.maxMinutes;
        return (
          <Card key={f.id}>
            <CardContent className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold">{f.name}</h3>
                  <p className="text-sm text-muted-foreground">
                    {f.building.name}{f.capacity ? ` · capacity ${f.capacity}` : ""}
                  </p>
                  <p className="mt-1 text-xs font-medium text-primary">
                    Max {effMax ? capLabel(effMax) : "3 h (default)"} per booking
                    {f.maxMinutes && f.building.maxMinutes && f.maxMinutes !== f.building.maxMinutes
                      ? ` (building default: ${capLabel(f.building.maxMinutes)})`
                      : ""}
                  </p>
                  {f.roleLimits.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {f.roleLimits.map((rl) => (
                        <Badge key={rl.role} variant="outline" className="text-primary">
                          {PRIMARY_ROLE_LABELS[rl.role] ?? rl.role}: {capLabel(rl.maxMinutes)}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {f.description && <p className="mt-1 text-sm text-muted-foreground">{f.description}</p>}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {f.allowedRoles.length === 0 ? (
                      <Badge>Open to all</Badge>
                    ) : (
                      f.allowedRoles.map((r) => <Badge key={r} variant="secondary">{PRIMARY_ROLE_LABELS[r] ?? r}</Badge>)
                    )}
                  </div>

                  {editingId === f.id && (
                    <div className="mt-3 grid gap-3 rounded-md border p-3">
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div className="grid gap-1">
                          <Label className="text-xs">Name</Label>
                          <Input value={String(editForm.name ?? "")} onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))} />
                        </div>
                        <div className="grid gap-1">
                          <Label className="text-xs">Capacity</Label>
                          <Input type="number" min={1} value={String(editForm.capacity ?? "")} onChange={(e) => setEditForm((p) => ({ ...p, capacity: e.target.value }))} />
                        </div>
                        <div className="grid gap-1">
                          <Label className="text-xs">Max booking (minutes)</Label>
                          <Input type="number" min={15} step={15} value={String(editForm.maxMinutes ?? "")} onChange={(e) => setEditForm((p) => ({ ...p, maxMinutes: e.target.value }))} placeholder="blank = building/3 h" />
                        </div>
                      </div>
                      <div className="grid gap-1">
                        <Label className="text-xs">Description</Label>
                        <Textarea rows={2} value={String(editForm.description ?? "")} onChange={(e) => setEditForm((p) => ({ ...p, description: e.target.value }))} />
                      </div>
                      <div className="grid gap-1">
                        <Label className="text-xs">Who may book</Label>
                        <div className="flex flex-wrap gap-3">
                          {PRIMARY_ROLES.map((r) => {
                            const arr = (editForm.allowedRoles as string[]) ?? [];
                            return (
                              <label key={r} className="flex items-center gap-1.5 text-xs">
                                <Checkbox
                                  checked={arr.includes(r)}
                                  onCheckedChange={(v) =>
                                    setEditForm((p) => ({
                                      ...p,
                                      allowedRoles: v ? [...arr, r] : arr.filter((x) => x !== r),
                                    }))
                                  }
                                />
                                {PRIMARY_ROLE_LABELS[r] ?? r}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                      <div className="grid gap-1">
                        <Label className="text-xs">Per-role max (minutes)</Label>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                          {PRIMARY_ROLES.map((r) => (
                            <Input
                              key={r}
                              type="number"
                              min={15}
                              step={15}
                              placeholder={PRIMARY_ROLE_LABELS[r] ?? r}
                              value={String(((editForm.roleLimits as Record<string, string>) ?? {})[r] ?? "")}
                              onChange={(e) =>
                                setEditForm((p) => ({
                                  ...p,
                                  roleLimits: { ...((p.roleLimits as Record<string, string>) ?? {}), [r]: e.target.value },
                                }))
                              }
                            />
                          ))}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => saveEdit(f)}>Save changes</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => (editingId === f.id ? setEditingId(null) : startEdit(f))}>
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </Button>
                  <Button variant="outline" size="sm" className="text-red-600" onClick={() => patchFacility(f.id, { active: false })}>
                    Deactivate
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
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
