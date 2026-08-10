import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { buildAuthorizeUrl } from "@/lib/sso";

export const dynamic = "force-dynamic";

export async function GET() {
  const store = await cookies();
  const state = crypto.randomUUID().replaceAll("-", "");
  const authorizeUrl = buildAuthorizeUrl(state);
  store.set("app4_oauth_state", state, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 300 });
  store.set("app4_return_to", "/", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
  return NextResponse.redirect(authorizeUrl);
}
