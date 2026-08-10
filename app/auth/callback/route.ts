import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createAppSession } from "@/lib/session";
import { checkAppAccess, exchangeCode, fetchUserInfo, verifyIdToken } from "@/lib/sso";

export async function GET(request: NextRequest) {
  const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";
  const proto = request.headers.get("x-forwarded-proto") ?? "http";
  const host = request.headers.get("host") ?? request.nextUrl.host;
  const publicOrigin = `${proto}://${host}`;
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const storedState = request.cookies.get("app4_oauth_state")?.value;
  if (!code || !state || state !== storedState) {
    return NextResponse.redirect(new URL(BASE_PATH + "/?error=state_mismatch", publicOrigin));
  }

  try {
    // 1. Identity — ask the SSO who the user is (token exchange + userinfo,
    //    id_token signature verified against the SSO JWKS).
    const tokens = await exchangeCode(code);
    await verifyIdToken(tokens.id_token);
    const user = await fetchUserInfo(tokens.access_token);

    // 2. Central application access — ask Main: is this user allowed in?
    const access = await checkAppAccess({ sub: user.sub, username: user.username });
    if (!access.allowed) {
      const res = NextResponse.redirect(new URL(BASE_PATH + "/access-denied", publicOrigin));
      res.cookies.delete("app4_oauth_state");
      return res;
    }

    // 3. Local role — App4 owns its own roles. Existing users keep their
    //    designation; new users start as USER (an ADMIN can change it).
    const localUser = await prisma.appUser.upsert({
      where: { username: user.username },
      update: {
        ssoUserId: user.sub,
        name: user.name,
        email: user.email,
        // Keep the primary role fresh from the SSO — eligibility depends on it.
        primaryRole: user.primaryRole ?? user.role ?? undefined,
      },
      create: {
        ssoUserId: user.sub,
        username: user.username,
        name: user.name,
        email: user.email,
        primaryRole: user.primaryRole ?? user.role ?? null,
        role: "USER",
      },
    });

    const session = await createAppSession({
      sub: user.sub,
      username: user.username,
      name: user.name,
      email: user.email,
      role: localUser.role,
      primaryRole: user.role ?? localUser.primaryRole ?? "",
    });

    // Return the user to the page they were on before being sent to the SSO.
    const returnTo = request.cookies.get("app4_return_to")?.value ?? "/";
    const safeReturn =
      returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
    const res = NextResponse.redirect(
      new URL(
        safeReturn.startsWith(BASE_PATH) ? safeReturn : BASE_PATH + safeReturn,
        publicOrigin
      )
    );
    res.cookies.delete("app4_return_to");
    res.cookies.set("app4_session", session, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 8,
      secure: process.env.COOKIE_SECURE === "true",
    });
    res.cookies.delete("app4_oauth_state");
    return res;
  } catch (err) {
    console.error("App4 SSO callback failed:", err);
    return NextResponse.redirect(new URL(BASE_PATH + "/?error=signin_failed", publicOrigin));
  }
}
