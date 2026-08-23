import "dotenv/config";
import { prisma } from "../src/lib/prisma";

const ROOMS: Array<{ name: string; desc: string; capacity: number | null }> = [
  { name: "Seminar Hall 01", desc: "Eastern Academic Block — 2nd Floor AV seminar hall. Sheet SH-01 (29 seats).", capacity: 29 },
  { name: "Seminar Hall 02", desc: "Eastern Academic Block — 2nd Floor AV seminar hall. Sheet SH-02 (29 seats).", capacity: 29 },
  { name: "Computer Lab 01", desc: "Eastern Academic Block — 3rd Floor AV computer lab. Sheet CL-01 (27 seats).", capacity: 27 },
  { name: "Computer Lab 02", desc: "Eastern Academic Block — 3rd Floor AV computer lab. Sheet CL-02 (27 seats).", capacity: 27 },
  { name: "60-Seater Classroom A-206", desc: "Eastern Academic Block — 1st Floor Room A-206. Sheet CR-A206 60-Seater A-206 (25 seats).", capacity: 25 },
  { name: "60-Seater Classroom C-206", desc: "Eastern Academic Block — 1st Floor Room C-206. Sheet CR-C206 60-Seater C-206 (25 seats).", capacity: 25 },
  { name: "60-Seater Classroom A-306", desc: "Eastern Academic Block — 2nd Floor Room A-306. Sheet CR-A306 60-Seater A-306 (25 seats).", capacity: 25 },
  { name: "Board Room (4F)", desc: "Eastern Academic Block — 4th Floor board room. Sheet BR Board Room (4F) (21 seats).", capacity: 21 },
  { name: "Auditorium (4F)", desc: "Eastern Academic Block — 4th Floor auditorium. Sheet AUD Auditorium (4F) (45 seats).", capacity: 45 },
];

async function main() {
  const buildingName = "Eastern Academic Block";
  const buildingCode = "EAB";
  console.log(`Syncing AV facilities — building: ${buildingName}`);

  let building = await prisma.building.findFirst({ where: { name: buildingName } });
  if (!building) {
    building = await prisma.building.findUnique({ where: { id: `seed-${buildingCode}` } }).catch(() => null) as typeof building;
  }
  if (!building) {
    building = await prisma.building.create({
      data: { id: `seed-${buildingCode}`, name: buildingName, code: buildingCode, description: "Eastern Academic Block — AV facilities (print each room sheet daily).", location: "Main Campus", order: 10, active: true, maxMinutes: null },
    });
    console.log(` created building ${building.name} (${building.id})`);
  } else {
    building = await prisma.building.update({
      where: { id: building.id },
      data: { name: buildingName, code: buildingCode, description: "Eastern Academic Block — AV facilities.", location: building.location ?? "Main Campus", active: true, maxMinutes: null },
    });
    console.log(` building OK: ${building.name} (${building.id}) maxMinutes=NULL (no limit)`);
  }

  await prisma.building.update({ where: { id: building.id }, data: { maxMinutes: null } });
  await prisma.facility.updateMany({ where: { buildingId: building.id }, data: { maxMinutes: null } });

  let created = 0, updated = 0;
  for (const r of ROOMS) {
    const existing = await prisma.facility.findFirst({ where: { buildingId: building!.id, name: r.name } });
    if (existing) {
      await prisma.facility.update({
        where: { id: existing.id },
        data: { description: r.desc, capacity: r.capacity, active: true, maxMinutes: null, allowedRoles: [] },
      });
      updated++;
      console.log(`  ~ ${r.name} (updated)`);
      await prisma.facilityRoleLimit.deleteMany({ where: { facilityId: existing.id } });
    } else {
      await prisma.facility.create({
        data: { buildingId: building!.id, name: r.name, description: r.desc, capacity: r.capacity, active: true, maxMinutes: null, allowedRoles: [] },
      });
      created++;
      console.log(`  + ${r.name}`);
    }
  }


  // Make sanyasinaidup.it the owner (Building POC) of Eastern Academic Block.
  // Facilities DB has no createdBy column -- ownership is modelled as Building POC,
  // which auto-propagates to every facility in the building (FacilityPoc fromBuilding=true).
  const ssoId = 'f7291d5c-118d-45b0-b0a2-163efef578c2';
  const ownerUsername = 'sanyasinaidup.it';
  let owner = await prisma.appUser.findUnique({ where: { username: ownerUsername } });
  if (!owner) owner = await prisma.appUser.findUnique({ where: { ssoUserId: ssoId } } as any);
  if (!owner) {
    owner = await prisma.appUser.create({
      data: { ssoUserId: ssoId, username: ownerUsername, name: 'Mr. Sanyasi Naidu Paila', email: 'sanyasinaidup.it@iipe.ac.in', primaryRole: 'STAFF_NON_TEACHING', role: 'USER' },
    });
    console.log(' provisioned AppUser ' + ownerUsername + ' (' + owner.id + ') from SSO ' + ssoId);
  } else if (!owner.ssoUserId) {
    owner = await prisma.appUser.update({ where: { id: owner.id }, data: { ssoUserId: ssoId, email: 'sanyasinaidup.it@iipe.ac.in', primaryRole: 'STAFF_NON_TEACHING' } });
    console.log(' linked AppUser ' + ownerUsername + ' to SSO ' + ssoId);
  } else {
    console.log(' owner AppUser OK: ' + ownerUsername + ' (' + owner.id + ')');
  }
  await prisma.buildingPoc.upsert({ where: { buildingId_userId: { buildingId: building.id, userId: owner.id } }, create: { buildingId: building.id, userId: owner.id }, update: {} });
  const facs = await prisma.facility.findMany({ where: { buildingId: building.id }, select: { id: true } });
  for (const f of facs) {
    await prisma.facilityPoc.upsert({ where: { facilityId_userId: { facilityId: f.id, userId: owner.id } }, create: { facilityId: f.id, userId: owner.id, fromBuilding: true }, update: {} });
  }
  console.log(' set ' + ownerUsername + ' as Building POC of ' + building.name + ' + ' + facs.length + ' Facility POCs (fromBuilding=true)');
  const all = await prisma.facility.findMany({ where: { buildingId: building.id }, orderBy: { name: "asc" } });
  console.log(`\nDone. EAB facilities: created ${created}, updated ${updated}, total ${all.length}`);
  for (const f of all) console.log(`  - ${f.name} maxMinutes=${String(f.maxMinutes)} allowedRoles=[${f.allowedRoles.join(",") || "everyone"}]`);
  console.log(`Building maxMinutes=${String((await prisma.building.findUnique({ where: { id: building.id } }))?.maxMinutes)} — no limit (NULL) as requested.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => prisma.$disconnect());
