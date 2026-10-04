import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifyAppSession } from "@/lib/session";

const CONFIG_ID = "default";

export type DashboardAccess = {
  /** True when the current session may open the dashboard at all. */
  visible: boolean;
  /** Facility ids this session may see, and export the history of. */
  facilityIds: string[];
  /** True when no configuration exists yet (admins see a setup hint). */
  unconfigured: boolean;
  /** True when the access comes from per-facility grants, not the whole list. */
  scoped: boolean;
};

/**
 * The facilities a person is named on, one by one: a facility dashboard viewer
 * row, an approval people row, or a POC row (the facility's own, or propagated
 * from its building). This is what makes access to one facility's dashboard
 * grantable to one person, without giving them anybody else's.
 */
async function grantedFacilityIds(userId: string): Promise<string[]> {
  const [viewers, approvers, facilityPocs, buildingPocs] = await Promise.all([
    prisma.facilityDashboardViewer.findMany({ where: { userId }, select: { facilityId: true } }),
    prisma.facilityApprover.findMany({ where: { userId }, select: { facilityId: true } }),
    prisma.facilityPoc.findMany({ where: { userId }, select: { facilityId: true } }),
    prisma.buildingPoc.findMany({ where: { userId }, select: { buildingId: true } }),
  ]);

  const ids = new Set<string>();
  for (const r of viewers) ids.add(r.facilityId);
  for (const r of approvers) ids.add(r.facilityId);
  for (const r of facilityPocs) ids.add(r.facilityId);

  const buildingIds = buildingPocs.map((r) => r.buildingId);
  if (buildingIds.length > 0) {
    const facilities = await prisma.facility.findMany({
      where: { buildingId: { in: buildingIds } },
      select: { id: true },
    });
    for (const f of facilities) ids.add(f.id);
  }
  return [...ids];
}

/**
 * Who may open the facilities dashboard, and which facilities it shows.
 *
 * Two layers, combined:
 *
 *   * the app administrator's configuration (DashboardConfig, single row, id
 *     "default") — a facility list and a viewer list. It still works exactly as
 *     before: whoever is on the viewer list sees the configured facilities.
 *   * per-facility grants — being a POC of a facility (or of its building), one
 *     of its approval people, or a named dashboard viewer of that one facility
 *     gives access to that facility, and only that facility.
 *
 * The app ADMIN always has access to everything — they are the one who
 * configures this page, so they can never lock themselves out of it — and so
 * does the central SUPER_ADMIN. The local role is read from the database rather
 * than from the session token, so a promotion or demotion takes effect
 * immediately, without waiting for the 8-hour session to expire.
 */
export async function dashboardAccess(): Promise<DashboardAccess> {
  const store = await cookies();
  const me = await verifyAppSession(store.get(SESSION_COOKIE)?.value ?? "");
  if (!me) return { visible: false, facilityIds: [], unconfigured: false, scoped: false };

  const config = await prisma.dashboardConfig.findUnique({ where: { id: CONFIG_ID } });
  const configured = config?.facilityIds ?? [];

  if (me.ssoRole === "SUPER_ADMIN") {
    return { visible: true, facilityIds: configured, unconfigured: !config, scoped: false };
  }

  const local = await prisma.appUser.findUnique({ where: { username: me.username } });
  if (local?.role === "ADMIN") {
    return { visible: true, facilityIds: configured, unconfigured: !config, scoped: false };
  }

  // Named on the dashboard's viewer list → the whole configured list, exactly
  // as before. Otherwise only the facilities this person is named on.
  const named = (config?.allowedUsernames ?? [])
    .map((u) => u.toLowerCase())
    .includes(me.username.toLowerCase());

  const ids = new Set<string>(named ? configured : []);
  if (local) {
    for (const id of await grantedFacilityIds(local.id)) ids.add(id);
  }

  return {
    visible: named || ids.size > 0,
    facilityIds: [...ids],
    unconfigured: false,
    scoped: true,
  };
}
