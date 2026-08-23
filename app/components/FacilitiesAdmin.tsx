"use client";
import { apiPath } from "sanapp-common-ui";
import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PocManager } from "./PocManager";
import { capLabel } from "@/lib/limits";
import { PRIMARY_ROLE_LABELS } from "@/lib/labels";

const PRIMARY_ROLES = ["STAFF_TEACHING", "STAFF_NON_TEACHING", "STUDENT", "SCHOLAR", "GUEST"];

type RoleLimit = { role: string; maxMinutes: number };
type Poc = { userId: string; fromBuilding?: boolean; user: { id: string; name: string; username: string } };

type Facility = {
  id: string;
  name: string;
  description: string | null;
  capacity: number | null;
  allowedRoles: string[];
  maxMinutes: number | null;
  roleLimits: RoleLimit[];
  active: boolean;
  pocs: Poc[];
};

type BuildingWithFacilities = {
  id: string;
  name: string;
  maxMinutes: number | null;
  active: boolean;
  facilities: Facility[];
};

export function FacilitiesAdmin({ initialBuildings }: { initialBuildings: BuildingWithFacilities[] }) {
  const [error, setError] = useState<string | null>(null);
  const [buildings, setBuildings] = useState<BuildingWithFacilities[]>(initialBuildings);
  const [buildingId, setBuildingId] = useState(initialBuildings[0]?.id ?? "");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [capacity, setCapacity] = useState("");
  const [allowedRoles, setAllowedRoles] = useState<string[]>([]);
  const [maxMinutes, setMaxMinutes] = useState("");
  const [roleLimits, setRoleLimits] = useState<Record<string, string>>({});

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Record<string, unknown>>({});

  async function reload() {
    const res = await fetch(apiPath("/api/buildings?all=1"), { cache: "no-store" });
    const data = await res.json();
    if (res.ok) {
      setBuildings(data.buildings);
      setBuildingId((prev) => prev || data.buildings[0]?.id || "");
    }
  }
  useEffect(() => {
    // initial state comes from the server render; nothing to fetch
  }, []);

  const building = buildings.find((b) => b.id === buildingId);

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
    if (!res.ok) return setError(data.error ?? "Could not create facility");
    setError(null);
    setName(""); setDescription(""); setCapacity(""); setAllowedRoles([]); setMaxMinutes(""); setRoleLimits({});
    await reload();
  }

  async function patchFacility(id: string, fields: Record<string, unknown>) {
    const res = await fetch(apiPath("/api/facilities"), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, ...fields }),
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error ?? "Could not update facility");
    setError(null);
    await reload();
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

  if (buildings.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          No buildings yet — add one on the <a className="text-primary underline" href={apiPath("/admin/buildings")}>Buildings &amp; POCs</a> page first.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="grid w-72 gap-1.5">
          <Label>Building</Label>
          <Select value={buildingId} onValueChange={setBuildingId}>
            <SelectTrigger><SelectValue placeholder="Select building" /></SelectTrigger>
            <SelectContent>
              {buildings.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <CardContent className="p-5">
          <h3 className="mb-3 font-semibold">Add a facility to {building?.name}</h3>
          <form onSubmit={create} className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-3">
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

      {building?.facilities.map((f) => {
        const effMax = f.maxMinutes ?? building.maxMinutes;
        return (
          <Card key={f.id} className={f.active ? undefined : "opacity-60"}>
            <CardContent className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold">
                    {f.name} {!f.active && <Badge variant="outline">inactive</Badge>}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {building.name}{f.capacity ? ` · capacity ${f.capacity}` : ""}
                  </p>
                  <p className="mt-1 text-xs font-medium text-primary">
                    Max {effMax ? capLabel(effMax) : "3 h (default)"} per booking
                    {f.maxMinutes && building.maxMinutes && f.maxMinutes !== building.maxMinutes
                      ? ` (building default: ${capLabel(building.maxMinutes)})`
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
                  <Button variant="outline" size="sm" className="text-red-600" onClick={() => patchFacility(f.id, { active: !f.active })}>
                    {f.active ? "Deactivate" : "Reactivate"}
                  </Button>
                </div>
              </div>

              <PocManager
                scope="facility"
                scopeId={f.id}
                initialPocs={f.pocs}
                onError={setError}
                note="POCs marked “(from building)” were inherited from the building POC list."
              />
            </CardContent>
          </Card>
        );
      })}

      {building && building.facilities.length === 0 && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No facilities in this building yet — add the first one above.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
