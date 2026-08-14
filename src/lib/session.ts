import { SignJWT, jwtVerify } from "jose";

const SECRET = new TextEncoder().encode(process.env.APP_SESSION_SECRET!);
const ISSUER = "iipe-app4";

export const SESSION_COOKIE = "app4_session";

export type AppUserSession = {
  sub: string;
  username: string;
  name: string;
  email: string;
  role: string;
  primaryRole: string;
  /** The central SSO role (SUPER_ADMIN | USER) — apps use it for platform-wide
   *  decisions like showing the Admin Console to the super admin. */
  ssoRole?: string;
};

// Session policy (overridable via env in production).
export const SESSION_CONFIG = {
  idleTimeoutMs: Number(process.env.SESSION_IDLE_MINUTES ?? 30) * 60 * 1000,
  keepaliveMs: Number(process.env.SESSION_KEEPALIVE_MINUTES ?? 4) * 60 * 1000,
  statusIntervalMs: Number(process.env.SESSION_STATUS_SECONDS ?? 30) * 1000,
  maxSessionSeconds: Number(process.env.SESSION_MAX_HOURS ?? 8) * 3600,
};

export type SessionMeta = { user: AppUserSession; exp: number; iat: number };

export async function createAppSession(user: AppUserSession): Promise<string> {
  return new SignJWT({
    username: user.username,
    name: user.name,
    email: user.email,
    role: user.role,
    primaryRole: user.primaryRole,
    ssoRole: user.ssoRole ?? "USER",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.sub)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(SECRET);
}

export async function verifyAppSessionFull(token: string): Promise<SessionMeta | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET, { issuer: ISSUER });
    if (!payload.sub || payload.exp === undefined || payload.iat === undefined) return null;
    return {
      user: {
        sub: payload.sub,
        username: String(payload.username ?? ""),
        name: String(payload.name ?? ""),
        email: String(payload.email ?? ""),
        role: String(payload.role ?? "USER"),
        primaryRole: String(payload.primaryRole ?? ""),
        ssoRole: String(payload.ssoRole ?? "USER"),
      },
      exp: payload.exp,
      iat: payload.iat,
    };
  } catch {
    return null;
  }
}

export async function verifyAppSession(token: string): Promise<AppUserSession | null> {
  const meta = await verifyAppSessionFull(token);
  return meta?.user ?? null;
}
