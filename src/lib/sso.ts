import { createRemoteJWKSet, jwtVerify } from "jose";

export const SSO_BASE_URL = process.env.SSO_BASE_URL!;
export const MAIN_BASE_URL = process.env.MAIN_BASE_URL!;
export const APP_BASE_URL = process.env.APP_BASE_URL!;
export const CLIENT_ID = process.env.APP_CLIENT_ID!;
export const CLIENT_SECRET = process.env.APP_CLIENT_SECRET!;
export const MAIN_API_KEY = process.env.MAIN_API_KEY!;

// Remote JWKS — lets this app verify SSO-signed id_tokens (RS256) without
// sharing any secret with the SSO.
const JWKS = createRemoteJWKSet(new URL(`${SSO_BASE_URL}/api/oidc/jwks`));

export function buildAuthorizeUrl(state: string): URL {
  // Keep the SSO base path (/sso) — the SSO itself is served behind Apache
  // under a base path, and new URL("/authorize", base) would drop it.
  const url = new URL(SSO_BASE_URL + "/authorize");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", `${APP_BASE_URL}/auth/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  return url;
}

export async function exchangeCode(code: string): Promise<{
  access_token: string;
  id_token: string;
}> {
  const res = await fetch(`${SSO_BASE_URL}/api/oidc/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${APP_BASE_URL}/auth/callback`,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed (${res.status})`);
  return res.json();
}

export async function fetchUserInfo(accessToken: string): Promise<{
  sub: string;
  username: string;
  name: string;
  email: string;
  role?: string; // SSO internal role (SUPER_ADMIN | USER)
  primaryRole?: string | null; // SSO PrimaryRole (STAFF_TEACHING, STUDENT, ...)
}> {
  const res = await fetch(`${SSO_BASE_URL}/api/oidc/userinfo`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Userinfo failed (${res.status})`);
  return res.json();
}

export async function verifyIdToken(idToken: string) {
  const { payload } = await jwtVerify(idToken, JWKS, {
    issuer: SSO_BASE_URL,
    audience: CLIENT_ID,
    algorithms: ["RS256"],
  });
  return payload;
}

export async function checkAppAccess(user: {
  sub: string;
  username: string;
}): Promise<{ allowed: boolean; role?: string; application?: { name: string } }> {
  const res = await fetch(`${MAIN_BASE_URL}/api/access/check`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-app-key": MAIN_API_KEY,
    },
    body: JSON.stringify({ userId: user.sub, username: user.username, clientId: CLIENT_ID }),
  });
  if (!res.ok) {
    throw new Error(`Main access check failed (${res.status})`);
  }
  return res.json();
}
