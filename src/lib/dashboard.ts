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
 * entirely decided by the app admin in DashboardConfig (single row, id
 * "default"): the facility list and the allowed-username list.
 * A central SUPER_ADMIN always has access; otherwise an app ADMIN whose
 * username is on the list (or any app admin when the list is empty).
 */
export async function dashboardAccess(): Promise<DashboardAccess> {
  const store = await cookies();
  const me = await verifyAppSession(store.get(SESSION_COOKIE)?.value ?? "");
  if (!me) return { visible: false, facilityIds: [], unconfigured: false };
  if (me.role !== "ADMIN" && me.ssoRole !== "SUPER_ADMIN") {
    return { visible: false, facilityIds: [], unconfigured: false };
  }
  const config = await prisma.dashboardConfig.findUnique({ where: { id: CONFIG_ID } });
  if (!config) return { visible: true, facilityIds: [], unconfigured: true };
  if (me.ssoRole !== "SUPER_ADMIN") {
    if (config.allowedUsernames.length > 0 && !config.allowedUsernames.includes(me.username.toLowerCase())) {
      return { visible: false, facilityIds: config.facilityIds, unconfigured: false };
    }
  }
  return { visible: true, facilityIds: config.facilityIds, unconfigured: false };
}
