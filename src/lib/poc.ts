import { prisma } from "@/lib/prisma";
import { listSsoUsers } from "@/lib/auth";

/**
 * POC model (per building + per facility):
 *
 * - A BUILDING POC is automatically POC of every facility in that building
 *   (propagated as FacilityPoc rows with fromBuilding = true), including
 *   facilities created later.
 * - A FACILITY POC (added explicitly) is POC of that single facility only.
 * - POCs may book slots longer than 3 hours on their own name and block
 *   slots (≤ 3 hours) for other users. Users needing long hours simply ask
 *   a POC of the facility's building / the facility itself.
 * - App ADMINs have every POC power everywhere.
 */

/**
 * Resolve a username to a local AppUser. Users who never signed in to this
 * app are auto-provisioned from the central SSO registry (same as the
 * on-behalf booking picker), so a POC can be added before their first login.
 */
export async function resolveUserByUsername(username: string) {
  const clean = username.trim().toLowerCase();
  if (!clean) return null;
  let user = await prisma.appUser.findFirst({
    where: { username: { equals: clean, mode: "insensitive" } },
  });
  if (user) return user;

  const ssoUsers = await listSsoUsers();
  const ssoUser = ssoUsers.find(
    (u) => u.username.toLowerCase() === clean || u.name.toLowerCase() === clean
  );
  if (!ssoUser) return null;
  return prisma.appUser.upsert({
    where: { username: ssoUser.username },
    update: {
      ssoUserId: ssoUser.id,
      name: ssoUser.name,
      email: ssoUser.email,
      primaryRole: ssoUser.primaryRole || null,
    },
    create: {
      ssoUserId: ssoUser.id,
      username: ssoUser.username,
      name: ssoUser.name,
      email: ssoUser.email,
      primaryRole: ssoUser.primaryRole || null,
      role: "USER",
    },
  });
}

/** True when the user is POC of this facility (facility-level OR building-level). */
export async function isPocOfFacility(userId: string, facilityId: string): Promise<boolean> {
  const facility = await prisma.facility.findUnique({
    where: { id: facilityId },
    select: { buildingId: true },
  });
  if (!facility) return false;
  const [facilityPoc, buildingPoc] = await Promise.all([
    prisma.facilityPoc.findUnique({
      where: { facilityId_userId: { facilityId, userId } },
    }),
    prisma.buildingPoc.findUnique({
      where: { buildingId_userId: { buildingId: facility.buildingId, userId } },
    }),
  ]);
  return !!facilityPoc || !!buildingPoc;
}

/** True when the user is a POC of at least one building or facility. */
export async function isPocAnywhere(userId: string): Promise<boolean> {
  const [b, f] = await Promise.all([
    prisma.buildingPoc.findFirst({ where: { userId } }),
    prisma.facilityPoc.findFirst({ where: { userId } }),
  ]);
  return !!b || !!f;
}

/** Add a building POC and propagate them to every facility in the building. */
export async function addBuildingPoc(buildingId: string, userId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.buildingPoc.upsert({
      where: { buildingId_userId: { buildingId, userId } },
      create: { buildingId, userId },
      update: {},
    });
    const facilities = await tx.facility.findMany({
      where: { buildingId },
      select: { id: true },
    });
    for (const f of facilities) {
      // Explicitly-added facility POCs (fromBuilding = false) stay explicit.
      await tx.facilityPoc.upsert({
        where: { facilityId_userId: { facilityId: f.id, userId } },
        create: { facilityId: f.id, userId, fromBuilding: true },
        update: {},
      });
    }
  });
}

/** Remove a building POC (and the auto-propagated facility POC rows). */
export async function removeBuildingPoc(buildingId: string, userId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.buildingPoc.deleteMany({ where: { buildingId, userId } });
    // Only the rows that were auto-added from the building assignment go;
    // facility POCs added explicitly for a single facility are kept.
    await tx.facilityPoc.deleteMany({
      where: { userId, fromBuilding: true, facility: { buildingId } },
    });
  });
}

/** Add a facility POC (explicit — overrides an auto-propagated row). */
export async function addFacilityPoc(facilityId: string, userId: string) {
  await prisma.facilityPoc.upsert({
    where: { facilityId_userId: { facilityId, userId } },
    create: { facilityId, userId, fromBuilding: false },
    update: { fromBuilding: false },
  });
}

export async function removeFacilityPoc(facilityId: string, userId: string) {
  await prisma.facilityPoc.deleteMany({ where: { facilityId, userId } });
}

/** Propagate a building's POCs to one facility (used when a facility is created). */
export async function propagateBuildingPocsToFacility(buildingId: string, facilityId: string) {
  const pocs = await prisma.buildingPoc.findMany({ where: { buildingId } });
  for (const p of pocs) {
    await prisma.facilityPoc.upsert({
      where: { facilityId_userId: { facilityId, userId: p.userId } },
      create: { facilityId, userId: p.userId, fromBuilding: true },
      update: {},
    });
  }
}
