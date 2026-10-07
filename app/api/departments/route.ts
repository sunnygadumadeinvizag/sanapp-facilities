import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";

/**
 * GET /api/departments — the institute's departments, straight from the SSO
 * registry (the same source the lab supervisor list comes from, so the two can
 * never disagree).
 *
 * Readable by every signed-in user: a lab booking must name a department, so
 * whoever is booking has to be able to search them. Only the name is exposed,
 * and the answer is cached briefly so a busy booking form does not hammer SSO.
 */

const SSO_BASE_URL = process.env.SSO_BASE_URL ?? "";
const SSO_ADMIN_KEY = process.env.SSO_ADMIN_KEY ?? "";

type Named = { id: string; name: string };

let cache: { at: number; departments: Named[] } | null = null;

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (cache && Date.now() - cache.at < 60_000) {
    return NextResponse.json({ departments: cache.departments, cached: true });
  }

  if (!SSO_ADMIN_KEY) return NextResponse.json({ departments: [] });

  try {
    const res = await fetch(`${SSO_BASE_URL}/api/admin/departments`, {
      headers: { "x-admin-key": SSO_ADMIN_KEY },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return NextResponse.json({ departments: cache?.departments ?? [] });
    }
    const data = await res.json().catch(() => ({}));
    const departments: Named[] = (Array.isArray(data.departments) ? data.departments : [])
      .map((d: { id?: unknown; name?: unknown }) => ({
        id: String(d?.id ?? ""),
        name: String(d?.name ?? "").trim(),
      }))
      .filter((d: Named) => d.name)
      .sort((a: Named, b: Named) => a.name.localeCompare(b.name));
    cache = { at: Date.now(), departments };
    return NextResponse.json({ departments });
  } catch {
    // The registry is unreachable — the booking form falls back to asking for
    // the department by name rather than blocking the booking entirely.
    return NextResponse.json({ departments: cache?.departments ?? [] });
  }
}
