"use client";
import { apiPath } from "sanapp-common-ui";
import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PocManager } from "./PocManager";
import { capLabel } from "@/lib/limits";

type Poc = { userId: string; user: { id: string; name: string; username: string } };

export type AdminBuilding = {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  location: string | null;
  order: number;
  active: boolean;
  maxMinutes: number | null;
  facilities: { id: string; name: string; active: boolean }[];
  pocs: Poc[];
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

  // Keep the list fresh after POC changes (the manager owns its own state;
  // reload buildings when it signals an update).
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    if (reloadKey === 0) return;
    void (async () => {
      const res = await fetch(apiPath("/api/buildings?all=1"), { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setBuildings(data.buildings);
    })();
  }, [reloadKey]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const f = e.currentTarget as HTMLFormElement;
    const fd = new FormData(f);
    const res = await fetch(apiPath("/api/buildings"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: String(fd.get("name") ?? ""),
        code: String(fd.get("code") ?? "").trim() || null,
        description: String(fd.get("description") ?? "").trim() || null,
        location: String(fd.get("location") ?? "").trim() || null,
        maxMinutes: String(fd.get("maxMinutes") ?? "") === "" ? null : Number(fd.get("maxMinutes")),
      }),
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error ?? "Could not create building");
    setError(null);
    f.reset();
    setReloadKey((k) => k + 1);
  }

  async function patch(id: string, fields: Record<string, unknown>) {
    const res = await fetch(apiPath("/api/buildings"), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, ...fields }),
    });
    const data = await res.json();
    if (!res.ok) return setError(data.error ?? "Could not update building");
    setError(null);
    setReloadKey((k) => k + 1);
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
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <Label htmlFor="b-name">Name *</Label>
                <Input id="b-name" name="name" required placeholder="e.g. Hostel Block" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="b-code">Code</Label>
                <Input id="b-code" name="code" placeholder="e.g. HB" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="b-max">Default max booking (minutes)</Label>
                <Input id="b-max" name="maxMinutes" type="number" min={15} step={15} placeholder="blank = 3 h (180)" />
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
            <div><Button type="submit">Add building</Button></div>
          </form>
        </CardContent>
      </Card>

      {buildings.map((b) => (
        <Card key={b.id} className={b.active ? undefined : "opacity-60"}>
          <CardContent className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold">
                  {b.name} {b.code ? `(${b.code})` : ""}{" "}
                  {!b.active && <Badge variant="outline">inactive</Badge>}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {b.facilities.filter((f) => f.active).length} facilities · {b.location ?? "no location"}
                </p>
                <p className="mt-1 text-xs font-medium text-primary">
                  Max {b.maxMinutes ? capLabel(b.maxMinutes) : "3 h (default)"} per booking per facility
                </p>
                {b.description && <p className="mt-1 text-sm text-muted-foreground">{b.description}</p>}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {b.facilities.map((f) => (
                    <Badge key={f.id} variant={f.active ? "secondary" : "outline"}>
                      {f.name}{!f.active && " (inactive)"}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const v = window.prompt(
                      `Default max booking (minutes) for ${b.name} — blank = 3 h default:`,
                      b.maxMinutes ? String(b.maxMinutes) : ""
                    );
                    if (v === null) return;
                    void patch(b.id, { maxMinutes: v.trim() === "" ? null : Number(v) });
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" /> Duration
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-red-600"
                  onClick={() => patch(b.id, { active: !b.active })}
                >
                  {b.active ? "Deactivate" : "Reactivate"}
                </Button>
              </div>
            </div>

            <PocManager
              scope="building"
              scopeId={b.id}
              initialPocs={b.pocs}
              onError={setError}
              onChanged={() => setReloadKey((k) => k + 1)}
              note="Building POCs automatically cover every facility in this building."
            />
          </CardContent>
        </Card>
      ))}

      <p className="text-xs text-muted-foreground">
        All times Indian Standard Time · today is {today} (IST).
      </p>
    </div>
  );
}
