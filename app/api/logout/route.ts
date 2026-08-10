import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

function isLocalPath(p: string) {
  return p.startsWith("/") && !p.startsWith("//") && !p.includes("..");
}

export async function GET(request: NextRequest) {
  let returnTo = request.nextUrl.searchParams.get("returnTo") ?? "";
  if (!isLocalPath(returnTo)) {
    const ref = request.headers.get("referer") ?? "";
    try {
      const refUrl = new URL(ref);
      const p = refUrl.pathname + refUrl.search;
      if (isLocalPath(p)) returnTo = p;
    } catch {
      /* ignore */
    }
  }
  if (!isLocalPath(returnTo)) returnTo = "/";

  const target = new URL(process.env.APP_BASE_URL! + returnTo);
  const ssoLogout = new URL(process.env.SSO_BASE_URL! + "/logout");
  ssoLogout.searchParams.set("post_logout_redirect_uri", target.toString());

  const res = NextResponse.redirect(ssoLogout, 303);
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
