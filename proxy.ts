import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifyAppSession } from "@/lib/session";
import { buildAuthorizeUrl } from "@/lib/sso";

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Strip the basePath (/app4) before matching routes so the proxy works
  // identically when the app is served behind Apache with a prefix.
  const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";
  const p =
    BASE_PATH && (pathname === BASE_PATH || pathname.startsWith(BASE_PATH + "/"))
      ? pathname.slice(BASE_PATH.length) || "/"
      : pathname;

  const isPublic =
    p === "/auth/callback" ||
    p === "/access-denied" ||
    p === "/api" ||
    p.startsWith("/api/") ||
    p.startsWith("/_next") ||
    p.startsWith("/favicon") ||
    p.match(/\.(svg|png|jpg|jpeg|gif|webp|ico)$/);

  if (isPublic) {
    return NextResponse.next();
  }

  const session = request.cookies.get(SESSION_COOKIE)?.value;
  const valid = session ? await verifyAppSession(session) : null;
  if (!valid) {
    const state = crypto.randomUUID().replaceAll("-", "");
    const authorizeUrl = buildAuthorizeUrl(state);

    const res = NextResponse.redirect(authorizeUrl);
    res.cookies.set("app4_oauth_state", state, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 300,
    });
    // Remember where the user was so the callback can send them back.
    res.cookies.set("app4_return_to", pathname + search, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
