import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifyAppSession } from "@/lib/session";
import { markAppNotificationsRead, queryAppNotifications } from "sanapp-common-ui";

export const dynamic = "force-dynamic";

const MAIN_BASE_URL = process.env.MAIN_BASE_URL ?? "http://localhost:3001";
const MAIN_API_KEY = process.env.MAIN_API_KEY;
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || process.env.BASE_PATH || "";

/**
 * GET — the signed-in user's notifications from the central hub (sanapp-main).
 * Default (scope=all) powers the header bell with EVERY application's
 * notifications, grouped by app; ?scope=app returns only what THIS app pushed
 * (its "App Notifications" page).
 */
export async function GET(request: NextRequest) {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  const user = token ? await verifyAppSession(token) : null;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const list = await queryAppNotifications({
    mainBaseUrl: MAIN_BASE_URL,
    appKey: MAIN_API_KEY,
    username: user.username,
    scope: sp.get("scope") === "app" ? "app" : "all",
    basePath: BASE_PATH,
    unreadOnly: sp.get("unread") === "1",
    limit: Number(sp.get("limit") ?? "30"),
    page: Number(sp.get("page") ?? "1"),
  });
  return NextResponse.json(list);
}

/**
 * POST — mark the user's notifications read:
 * { ids?: string[], all?: boolean, scope?: "all" | "app" }.
 * Scope "app" (this application's own App Notifications page) keeps "all"
 * scoped to this application so the page never clears other apps'
 * notifications; the default "all" is the cross-app header bell, which must
 * clear every application's rows.
 */
export async function POST(request: NextRequest) {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  const user = token ? await verifyAppSession(token) : null;
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: any;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  // The hub scopes "mark all" by basePath, so only forward ours when the
  // caller asked for app scope — the header bell's "mark all" is cross-app.
  const scope = body?.scope === "app" ? "app" : "all";

  await markAppNotificationsRead({
    mainBaseUrl: MAIN_BASE_URL,
    appKey: MAIN_API_KEY,
    username: user.username,
    ids: Array.isArray(body?.ids) ? body.ids : undefined,
    all: body?.all === true,
    basePath: scope === "app" ? BASE_PATH : undefined,
  });
  return NextResponse.json({ ok: true });
}
