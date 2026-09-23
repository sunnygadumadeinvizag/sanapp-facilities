import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifyAppSession } from "@/lib/session";

const CONFIG_ID = "default";

export type DashboardAccess = {
  /** True when the current session may open the dashboard at all. */
  visible: boolean;
  /** Facility ids configured for the dashboard (empty = nothing configured yet). */
  facilityIds: string[];
  /** True when no configuration exists yet (admins see a setup hint). */
  unconfigured: boolean;
};

/**
 * Who may open the facilities dashboard, and which facilities it shows —
 * decided by the app administrator in DashboardConfig (single row, id
 * "default"): the facility list and the viewer list.
 *
 * Rules:
 *   * the central SUPER_ADMIN always has access;
 *   * the app ADMIN always has access — they are the one who configures this
 *     page, so they can never lock themselves out of it;
 *   * anyone else the administrator has added to the viewer list has access,
 *     whatever their local role (ADMIN or USER).
 *
 * The admin flag is read from the database rather than the session token so a
 * promotion or demotion takes effect immediately, without waiting for the
 * 8-hour session to expire.
 */
export async function dashboardAccess(): Promise<DashboardAccess> {
  const store = await cookies();
  const me = await verifyAppSession(store.get(SESSION_COOKIE)?.value ?? "");
  if (!me) return { visible: false, facilityIds: [], unconfigured: false };

  const config = await prisma.dashboardConfig.findUnique({ where: { id: CONFIG_ID } });
  const facilityIds = config?.facilityIds ?? [];

  if (me.ssoRole === "SUPER_ADMIN") {
    return { visible: true, facilityIds, unconfigured: !config };
  }

  const local = await prisma.appUser.findUnique({ where: { username: me.username } });
  if (local?.role === "ADMIN") {
    return { visible: true, facilityIds, unconfigured: !config };
  }

  // Anyone else — any primary role, any local role — sees the dashboard only
  // once the app administrator has added their username to the viewer list.
  const allowed = (config?.allowedUsernames ?? []).map((u) => u.toLowerCase());
  return {
    visible: allowed.includes(me.username.toLowerCase()),
    facilityIds,
    unconfigured: false,
  };
}
