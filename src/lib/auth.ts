import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyAppSession } from "@/lib/session";

/** The locally-provisioned user for the current session, or null. */
export async function currentUser() {
  const store = await cookies();
  const session = store.get("app4_session")?.value;
  const user = session ? await verifyAppSession(session) : null;
  if (!user) return null;
  return prisma.appUser.findUnique({ where: { username: user.username } });
}

/** True when the current user is an app ADMIN. */
export async function isAdmin(): Promise<boolean> {
  const user = await currentUser();
  return user?.role === "ADMIN";
}

/**
 * True when the current session may use the app admin console: the local app
 * ADMIN role, or a central SUPER_ADMIN (matches what the sidebar shows).
 */
export async function isAdminSession(): Promise<boolean> {
  const store = await cookies();
  const session = store.get("app4_session")?.value;
  const me = session ? await verifyAppSession(session) : null;
  if (!me) return false;
  if (me.ssoRole === "SUPER_ADMIN") return true;
  const user = await prisma.appUser.findUnique({ where: { username: me.username } });
  return user?.role === "ADMIN";
}

const SSO_BASE_URL = process.env.SSO_BASE_URL ?? "";
const SSO_ADMIN_KEY = process.env.SSO_ADMIN_KEY ?? "";

export type SsoUser = {
  id: string;
  username: string;
  name: string;
  email: string | null;
  primaryRole: string;
  isActive: boolean;
};

let ssoUsersCache: { at: number; users: SsoUser[] } | null = null;

/**
 * List of users from the central SSO registry (identity lives in sanapp_sso_db, not
 * here). Used by APPROVERs to pick who a blocked slot is for, and by ADMINs
 * for designation management. Cached briefly to keep the SSO happy.
 */
export async function listSsoUsers(): Promise<SsoUser[]> {
  if (ssoUsersCache && Date.now() - ssoUsersCache.at < 30_000) {
    return ssoUsersCache.users;
  }
  if (!SSO_ADMIN_KEY) return [];
  try {
    const res = await fetch(`${SSO_BASE_URL}/api/admin/users`, {
      headers: { "x-admin-key": SSO_ADMIN_KEY },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const users: SsoUser[] = (data.users ?? []).map((u: any) => ({
      id: u.id,
      username: u.username,
      name: u.name,
      email: u.email ?? null,
      primaryRole: u.primaryRole || "",
      isActive: u.isActive !== false,
    }));
    ssoUsersCache = { at: Date.now(), users };
    return users;
  } catch {
    return [];
  }
}
