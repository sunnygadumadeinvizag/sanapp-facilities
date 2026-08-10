import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  SESSION_CONFIG,
  createAppSession,
  verifyAppSessionFull,
} from "@/lib/session";

const RENEW_BEFORE_SECONDS = 5 * 60;

export async function POST() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  const meta = token ? await verifyAppSessionFull(token) : null;

  if (!meta) {
    return NextResponse.json({ valid: false, error: "no_session" }, { status: 401 });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now - meta.iat > SESSION_CONFIG.maxSessionSeconds) {
    // Absolute maximum session length reached — force re-authentication.
    const res = NextResponse.json(
      { valid: false, error: "max_session_reached" },
      { status: 401 }
    );
    res.cookies.set(SESSION_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    return res;
  }

  if (meta.exp - now < RENEW_BEFORE_SECONDS) {
    const session = await createAppSession(meta.user);
    const res = NextResponse.json({ valid: true, renewed: true });
    res.cookies.set(SESSION_COOKIE, session, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 8,
      secure: process.env.COOKIE_SECURE === "true",
    });
    return res;
  }

  return NextResponse.json({ valid: true, renewed: false });
}
