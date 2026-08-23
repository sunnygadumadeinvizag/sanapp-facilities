import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifyAppSessionFull } from "@/lib/session";
import { CLIENT_ID, CLIENT_SECRET, SSO_BASE_URL } from "@/lib/sso";

export async function GET() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  const meta = token ? await verifyAppSessionFull(token) : null;
  if (!meta) {
    return NextResponse.json({ valid: false, reason: "no_app_session" });
  }

  // The browser forwards the central SSO cookie to us (same host) — ask the
  // SSO whether it is still valid. If the user signed out in another tab or
  // another application, this turns invalid and every tab signs out.
  const ssoSession = store.get("sso_session")?.value;
  if (!ssoSession) {
    return NextResponse.json({ valid: false, reason: "no_sso_session" });
  }

  try {
    const checkRes = await fetch(`${SSO_BASE_URL}/api/session/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        ssoSession,
      }),
      cache: "no-store",
    });
    const data = checkRes.ok ? await checkRes.json() : { valid: false };
    // The SSO session must belong to the SAME user as this app's session —
    // a valid session for a DIFFERENT user (account switched after an
    // incomplete logout) must not keep the old user signed in here.
    const appUsername = meta.user?.username ?? "";
    const sameUser =
      data.valid !== true ||
      typeof data.username !== "string" ||
      data.username.toLowerCase() === appUsername.toLowerCase();
    return NextResponse.json({
      valid: data.valid === true && sameUser,
      reason: data.valid !== true ? "sso_session_invalid" : sameUser ? undefined : "sso_user_changed",
    });
  } catch {
    // SSO unreachable — do not sign the user out over a transient network error.
    return NextResponse.json({ valid: true, reason: "sso_unreachable" });
  }
}
