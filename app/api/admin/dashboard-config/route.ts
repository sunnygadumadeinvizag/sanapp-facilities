import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdminSession, listSsoUsers } from "@/lib/auth";

const CONFIG_ID = "default";

/** Facility ids from the request body (validated: must exist). */
function facilityIdList(value: unknown): string[] {
  const arr = Array.isArray(value) ? value.map((v) => String(v ?? "").trim()) : [];
  return [...new Set(arr.filter(Boolean))].slice(0, 200);
}

/**
 * Viewer usernames. Stored lower-cased so the lookup in dashboardAccess() is
 * case-insensitive. These are people — app admins always have access anyway,
 * and this list grants access to anyone else.
 */
function usernameList(value: unknown): string[] {
  const arr = Array.isArray(value)
    ? value.map((v) => String(v ?? "").trim().toLowerCase())
    : typeof value === "string"
      ? value.split(/[\n,;]+/).map((v) => v.trim().toLowerCase())
      : [];
  return [...new Set(arr.filter(Boolean))].slice(0, 500);
}

/**
 * GET /api/admin/dashboard-config — the current dashboard configuration
 * (which facilities are shown, which people may view it). Admin gated.
 */
export async function GET() {
  if (!(await isAdminSession())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const config = await prisma.dashboardConfig.findUnique({ where: { id: CONFIG_ID } });
  return NextResponse.json({
    facilityIds: config?.facilityIds ?? [],
    allowedUsernames: config?.allowedUsernames ?? [],
  });
}

/**
 * PUT /api/admin/dashboard-config — save the configuration.
 * Body: { facilityIds: string[], allowedUsernames: string[] | string }
 *
 * The viewer list may name ANY person, not only app admins: a username is
 * accepted when it exists either in the central SSO registry or as a local user
 * of this app. Someone who has never signed in here can still be added ahead of
 * time — their first login creates the local record, and the viewer check
 * matches on username.
 *
 * If the SSO registry cannot be reached the strict check is skipped rather than
 * blocking the administrator: an unknown name simply grants nobody access, and
 * the list can be corrected on the next save.
 */
export async function PUT(request: NextRequest) {
  if (!(await isAdminSession())) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const facilityIds = facilityIdList(body.facilityIds);
  if (facilityIds.length > 0) {
    const known = await prisma.facility.findMany({
      where: { id: { in: facilityIds } },
      select: { id: true },
    });
    const knownSet = new Set(known.map((f) => f.id));
    const unknown = facilityIds.filter((f) => !knownSet.has(f));
    if (unknown.length > 0) {
      return NextResponse.json({ error: `Unknown facility id(s): ${unknown.join(", ")}` }, { status: 400 });
    }
  }

  const allowedUsernames = usernameList(body.allowedUsernames);
  if (allowedUsernames.length > 0) {
    const [ssoUsers, localUsers] = await Promise.all([
      listSsoUsers(),
      prisma.appUser.findMany({
        where: { username: { in: allowedUsernames } },
        select: { username: true },
      }),
    ]);
    if (ssoUsers.length > 0) {
      const knownSet = new Set<string>([
        ...ssoUsers.map((u) => u.username.toLowerCase()),
        ...localUsers.map((u) => u.username.toLowerCase()),
      ]);
      const unknown = allowedUsernames.filter((u) => !knownSet.has(u));
      if (unknown.length > 0) {
        return NextResponse.json(
          { error: `Unknown username(s): ${unknown.join(", ")} — check the SSO registry` },
          { status: 400 }
        );
      }
    }
  }

  const saved = await prisma.dashboardConfig.upsert({
    where: { id: CONFIG_ID },
    update: { facilityIds, allowedUsernames },
    create: { id: CONFIG_ID, facilityIds, allowedUsernames },
  });
  return NextResponse.json({
    facilityIds: saved.facilityIds,
    allowedUsernames: saved.allowedUsernames,
  });
}
