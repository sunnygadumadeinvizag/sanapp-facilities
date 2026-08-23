"use client";
import { apiPath } from "sanapp-common-ui";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserPlus, X } from "lucide-react";

export type Poc = {
  userId: string;
  fromBuilding?: boolean;
  user: { id: string; name: string; username: string };
};

/**
 * Add/remove POCs for one building or facility. POCs are added by username
 * (resolved against the SSO registry) — the full user list is never shown.
 */
export function PocManager({
  scope,
  scopeId,
  initialPocs,
  note,
  onError,
  onChanged,
}: {
  scope: "building" | "facility";
  scopeId: string;
  initialPocs: Poc[];
  note?: string;
  onError: (s: string | null) => void;
  onChanged?: () => void;
}) {
  const [pocs, setPocs] = useState<Poc[]>(initialPocs);
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const who = username.trim();
    if (!who || busy) return;
    setBusy(true);
    onError(null);
    try {
      const res = await fetch(apiPath("/api/pocs"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope, scopeId, username: who }),
      });
      const data = await res.json();
      if (!res.ok) {
        onError(data.error ?? "Could not add POC");
        return;
      }
      setPocs(data.pocs);
      setUsername("");
      onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  async function remove(userId: string) {
    if (busy) return;
    setBusy(true);
    onError(null);
    try {
      const params = new URLSearchParams({ scope, scopeId, userId });
      const res = await fetch(apiPath(`/api/pocs?${params.toString()}`), { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        onError(data.error ?? "Could not remove POC");
        return;
      }
      setPocs(data.pocs);
      onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">POCs</span>
        {pocs.length === 0 && (
          <span className="text-xs text-muted-foreground">none yet — long-hour bookings are blocked until a POC is added</span>
        )}
        {pocs.map((p) => (
          <Badge key={p.userId} variant="secondary" className="gap-1.5 py-1 pl-2.5 pr-1">
            <span>
              {p.user.name} <span className="font-normal opacity-70">@{p.user.username}</span>
              {scope === "facility" && p.fromBuilding && (
                <span className="ml-1 font-normal opacity-70">(from building)</span>
              )}
            </span>
            <button
              type="button"
              aria-label={`Remove ${p.user.name} as POC`}
              title="Remove POC"
              className="rounded-sm px-1 hover:bg-black/10"
              onClick={() => remove(p.userId)}
              disabled={busy}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
      </div>
      <form onSubmit={add} className="mt-2 flex flex-wrap items-center gap-2">
        <Input
          className="w-64"
          placeholder="Add POC by username or name…"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          aria-label={`Add ${scope} POC by username`}
        />
        <Button type="submit" size="sm" variant="outline" disabled={busy || !username.trim()}>
          <UserPlus className="h-3.5 w-3.5" /> Add POC
        </Button>
      </form>
      {note && <p className="mt-1.5 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}
