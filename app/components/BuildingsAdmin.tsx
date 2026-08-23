"use client";

import { apiPath } from "sanapp-common-ui";
import { useEffect, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type AdminBuilding = {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  location: string | null;
  order: number;
  active: boolean;
  facilities: { id: string; name: string; active: boolean }[];
};

export function BuildingsAdmin({
  initialBuildings,
  today,
}: {
  initialBuildings: AdminBuilding[];
  today: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [buildings, setBuildings] = useState<AdminBuilding[]>(initialBuildings);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (reloadKey === 0) return;
    void (async () => {
      try {
        const res = await fetch(apiPath("/api/buildings?all=1"), { cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as { buildings?: AdminBuilding[]; error?: string };
        if (!res.ok) {
          setError(data.error ?? "Could not reload buildings");
          return;
        }
        if (Array.isArray(data.buildings)) setBuildings(data.buildings);
      } catch {
        setError("Could not reload buildings");
      }
    })();
  }, [reloadKey]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const f = e.currentTarget as HTMLFormElement;
    const fd = new FormData(f);
    try {
      const res = await fetch(apiPath("/api/buildings"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: String(fd.get("name") ?? ""),
          code: String(fd.get("code") ?? "").trim() || null,
          description: String(fd.get("description") ?? "").trim() || null,
          location: String(fd.get("location") ?? "").trim() || null,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not create building");
        return;
      }
      setError(null);
      f.reset();
      setReloadKey((k) => k + 1);
    } catch {
      setError("Could not create building");
    }
  }

  async function patch(id: string, fields: Record<string, unknown>) {
    try {
      const res = await fetch(apiPath("/api/buildings"), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, ...fields }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not update building");
        return;
      }
      setError(null);
      setReloadKey((k) => k + 1);
    } catch {
      setError("Could not update building");
    }
  }

  async function removeBuilding(id: string, name: string) {
    if (!confirm(`Delete building "${name}"? Facilities inside must be deleted first.`)) return;
    try {
      const res = await fetch(apiPath("/api/buildings"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op: "delete", id }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not delete building");
        return;
      }
      setError(null);
      setReloadKey((k) => k + 1);
    } catch {
      setError("Could not delete building");
    }
  }

  function startEdit(b: AdminBuilding) {
    setEditingId(b.id);
    setEditForm({ name: b.name, code: b.code ?? "", description: b.description ?? "", location: b.location ?? "" });
  }

  async function saveEdit(id: string) {
    const name = editForm.name?.trim() ?? "";
    if (!name) {
      setError("Building name is required");
      return;
    }
    await patch(id, {
      name,
      code: editForm.code?.trim() || null,
      description: editForm.description?.trim() || null,
      location: editForm.location?.trim() || null,
    });
    setEditingId(null);
  }

  return (
    <div className="grid gap-4">
      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      <Card>
        <CardContent className="p-5">
          <h3 className="mb-3 font-semibold">Add a building</h3>
          <form onSubmit={create} className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="b-name">Name *</Label>
                <Input id="b-name" name="name" required placeholder="e.g. Hostel Block" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="b-code">Code</Label>
                <Input id="b-code" name="code" placeholder="e.g. HB" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="b-desc">Description</Label>
              <Textarea id="b-desc" name="description" rows={2} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="b-loc">Location</Label>
              <Input id="b-loc" name="location" placeholder="e.g. Main Campus, Block A" />
            </div>
            <div>
              <Button type="submit">Add building</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {buildings.map((b) => (
        <Card key={b.id} className={b.active ? undefined : "opacity-60"}>
          <CardContent className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold">
                  {b.name} {b.code ? `(${b.code})` : ""} {!b.active && <Badge variant="outline">inactive</Badge>}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {b.facilities.filter((f) => f.active).length} facilities · {b.location ?? "no location"}
                </p>
                {b.description && <p className="mt-1 text-sm text-muted-foreground">{b.description}</p>}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {b.facilities.map((f) => (
                    <Badge key={f.id} variant={f.active ? "secondary" : "outline"}>
                      {f.name}
                      {!f.active && " (inactive)"}
                    </Badge>
                  ))}
                  {b.facilities.length === 0 && <span className="text-xs text-muted-foreground">No facilities yet.</span>}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => (editingId === b.id ? setEditingId(null) : startEdit(b))}>
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
                <Button variant="outline" size="sm" className="text-red-600" onClick={() => patch(b.id, { active: !b.active })}>
                  {b.active ? "Deactivate" : "Reactivate"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-red-600"
                  onClick={() => removeBuilding(b.id, b.name)}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
              </div>
            </div>

            {editingId === b.id && (
              <div className="mt-3 grid gap-3 rounded-md border p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Name *</Label>
                    <Input value={editForm.name ?? ""} onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Code</Label>
                    <Input value={editForm.code ?? ""} onChange={(e) => setEditForm((p) => ({ ...p, code: e.target.value }))} />
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Description</Label>
                  <Textarea rows={2} value={editForm.description ?? ""} onChange={(e) => setEditForm((p) => ({ ...p, description: e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Location</Label>
                  <Input value={editForm.location ?? ""} onChange={(e) => setEditForm((p) => ({ ...p, location: e.target.value }))} />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => saveEdit(b.id)}>
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      <p className="text-xs text-muted-foreground">All times Indian Standard Time · today is {today} (IST).</p>
    </div>
  );
}
