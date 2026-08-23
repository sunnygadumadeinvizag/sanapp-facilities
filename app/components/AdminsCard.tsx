"use client";
import { apiPath } from "sanapp-common-ui";
import { useEffect, useState } from "react";
import { ShieldCheck, UserPlus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Admin = {
  id: string;
  username: string;
  name: string;
  email: string | null;
  primaryRole: string | null;
  role: string;
};

/**
 * App administrator management — admins are added BY USERNAME (resolved via
 * the SSO registry), never from a full user listing.
 */
export function AdminsCard() {
  const [admins, setAdmins] = useState<Admin[] | null>(null);
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch(apiPath("/api/users?kind=admins"), { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (res.ok) setAdmins(data.users ?? []);
  }
  useEffect(() => {
    void load();
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const who = username.trim();
    if (!who || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(apiPath("/api/users"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: who }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not add administrator");
        return;
      }
      setAdmins(data.users ?? []);
      setUsername("");
    } finally {
      setBusy(false);
    }
  }

  async function demote(a: Admin) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(apiPath("/api/users"), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: a.id, role: "USER" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not demote administrator");
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-sm text-muted-foreground">
          App administrators manage buildings, facilities, POCs and can see every booking.
        </p>
        {error && (
          <div className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {(admins ?? []).map((a) => (
            <Badge key={a.id} variant="secondary" className="gap-1.5 py-1 pl-2.5 pr-1">
              <ShieldCheck className="h-3 w-3" />
              <span>
                {a.name} <span className="font-normal opacity-70">@{a.username}</span>
              </span>
              <button
                type="button"
                aria-label={`Demote ${a.name}`}
                title="Demote to regular user"
                className="rounded-sm px-1 hover:bg-black/10"
                onClick={() => demote(a)}
                disabled={busy}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          {admins !== null && admins.length === 0 && (
            <span className="text-sm text-muted-foreground">No administrators yet.</span>
          )}
        </div>
        <form onSubmit={add} className="mt-3 flex flex-wrap items-center gap-2">
          <Input
            className="w-72"
            placeholder="Add administrator by username or name…"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            aria-label="Add administrator by username"
          />
          <Button type="submit" size="sm" variant="outline" disabled={busy || !username.trim()}>
            <UserPlus className="h-3.5 w-3.5" /> Add administrator
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
