import "dotenv/config";
import { prisma } from "../src/lib/prisma";

type BuildingSeed = {
  name: string;
  code: string;
  description: string;
  location: string;
  maxMinutes?: number | null;
};

type FacilitySeed = {
  key: string;
  building: string;
  name: string;
  description: string;
  capacity: number;
  allowedRoles: readonly string[];
  maxMinutes?: number | null;
};

async function main() {
  console.log("Seeding sanapp_facilities_db (Facilities Booking) …");

  // ------------------------------------------------------------------
  // Users — provisioned from the central SSO at first login. Usernames
  // must match SSO usernames; designations set here are kept because the
  // SSO callback only updates identity fields.
  // ------------------------------------------------------------------
  const users = [
    { username: "admin", name: "System Administrator", role: "ADMIN", isApprover: true, isPoc: true },
    { username: "sanyasi", name: "Sanyasi Naidu", role: "USER", isApprover: true, isPoc: true },
    { username: "ramesh", name: "Ramesh Kumar", role: "USER", isApprover: true, isPoc: false },
    { username: "lakshmi", name: "Lakshmi Devi", role: "USER", isApprover: false, isPoc: true },
    { username: "geeta", name: "Geeta Sharma", role: "USER", isApprover: false, isPoc: false },
    { username: "kiran", name: "Kiran Rao", role: "USER", isApprover: false, isPoc: false },
    { username: "venkat", name: "Venkat Reddy", role: "USER", isApprover: false, isPoc: false },
  ] as const;

  for (const u of users) {
    await prisma.appUser.upsert({
      where: { username: u.username },
      update: { name: u.name, role: u.role, isApprover: u.isApprover, isPoc: u.isPoc },
      create: { username: u.username, name: u.name, role: u.role, isApprover: u.isApprover, isPoc: u.isPoc },
    });
  }
  console.log(`  users: ${users.map((u) => u.username).join(", ")}`);

  // ------------------------------------------------------------------
  // Buildings
  // ------------------------------------------------------------------
  // Buildings — Eastern Academic Block (EAB) holds the 9 AV rooms from the printed sheet:
  //   SH-01/02 Seminar Halls, CL-01/02 Computer Labs, CR-A206/C206/A306 60-seaters, BR (4F), AUD (4F).
  //   EAB has no duration limit (maxMinutes = null); same for every AV facility.
  const buildings: BuildingSeed[] = [
    { name: "Eastern Academic Block", code: "EAB", description: "Eastern Academic Block — AV facilities (Seminar Halls, Computer Labs, 60-seater Classrooms, Board Room and Auditorium).", location: "Main Campus", maxMinutes: null },
    { name: "Main Academic Block", code: "MAB", description: "Classrooms, faculty cabins and the central lecture halls.", location: "Main Campus" },
    { name: "Library & Learning Centre", code: "LIB", description: "Reading halls, digital resource rooms and group study areas.", location: "Main Campus" },
    { name: "Administration Building", code: "ADM", description: "Administrative offices and meeting rooms.", location: "Main Campus" },
    { name: "Sports Complex", code: "SPT", description: "Indoor courts, gymnasium and multipurpose hall.", location: "North Campus" },
    { name: "Guest House", code: "GH", description: "Visitor accommodation and conference facilities.", location: "South Campus" },
  ];

  const buildingIds: Record<string, string> = {};
  for (const [i, b] of buildings.entries()) {
    const row = await prisma.building.upsert({
      where: { id: `seed-${b.code}` },
      update: { name: b.name, code: b.code, description: b.description, location: b.location, order: i, active: true, maxMinutes: b.maxMinutes },
      create: { id: `seed-${b.code}`, name: b.name, code: b.code, description: b.description, location: b.location, order: i, active: true, maxMinutes: b.maxMinutes },
    });
    buildingIds[b.code] = row.id;
  }
  console.log(`  buildings: ${buildings.map((b) => b.name).join(", ")}`);

  // ------------------------------------------------------------------
  // Facilities — allowedRoles is the list of SSO primary roles that may
  // book. Empty = everyone. Primary roles come from the central SSO:
  //   STAFF_TEACHING, STAFF_NON_TEACHING, STUDENT, SCHOLAR, GUEST
  // ------------------------------------------------------------------
  const ALL = [] as const;
  const STAFF = ["STAFF_TEACHING", "STAFF_NON_TEACHING"] as const;
  const ACADEMIC = ["STAFF_TEACHING", "STAFF_NON_TEACHING", "STUDENT", "SCHOLAR"] as const;

  const facilities: FacilitySeed[] = [
    // Main Academic Block
    { key: "mab-seminar", building: "MAB", name: "Seminar Hall (Capacity 120)", description: "Projector, sound system and video-conferencing. Ideal for seminars and workshops.", capacity: 120, allowedRoles: ACADEMIC },
    { key: "mab-classroom-a", building: "MAB", name: "Classroom A", description: "Smart classroom with 60 seats.", capacity: 60, allowedRoles: ACADEMIC },
    { key: "mab-meeting-1", building: "MAB", name: "Meeting Room 1", description: "Small meeting room for 12 people.", capacity: 12, allowedRoles: STAFF },
    // Library
    { key: "lib-reading-hall", building: "LIB", name: "Reading Hall", description: "Silent reading hall with 80 seats.", capacity: 80, allowedRoles: ACADEMIC },
    { key: "lib-group-study", building: "LIB", name: "Group Study Room", description: "Room for group discussions, 15 seats.", capacity: 15, allowedRoles: ACADEMIC },
    // Administration
    { key: "adm-board-room", building: "ADM", name: "Board Room", description: "Board meetings and official presentations.", capacity: 25, allowedRoles: STAFF },
    { key: "adm-conference", building: "ADM", name: "Conference Room", description: "Large conference room with AV setup.", capacity: 40, allowedRoles: STAFF },
    // Sports
    { key: "spt-multipurpose", building: "SPT", name: "Multipurpose Indoor Hall", description: "Indoor court for badminton, basketball and events.", capacity: 100, allowedRoles: ALL },
    { key: "spt-gym", building: "SPT", name: "Gymnasium", description: "Fitness centre with modern equipment.", capacity: 30, allowedRoles: ALL },
    // Guest House
    { key: "gh-conference", building: "GH", name: "Guest House Conference Hall", description: "Conference facility for external visitors.", capacity: 35, allowedRoles: STAFF },
    { key: "gh-lounge", building: "GH", name: "Guest Lounge", description: "Lounge for visitors and guests.", capacity: 20, allowedRoles: ALL },
    // Eastern Academic Block — AV facilities (sheet in screenshot). No duration
    // limit — each room overrides building/platform caps with maxMinutes: null.
    { key: "eab-sh01", building: "EAB", name: "Seminar Hall 01", description: "Eastern Academic Block — 2nd Floor AV seminar hall. Sheet SH-01 (29 seats).", capacity: 29, allowedRoles: ALL, maxMinutes: null },
    { key: "eab-sh02", building: "EAB", name: "Seminar Hall 02", description: "Eastern Academic Block — 2nd Floor AV seminar hall. Sheet SH-02 (29 seats).", capacity: 29, allowedRoles: ALL, maxMinutes: null },
    { key: "eab-cl01", building: "EAB", name: "Computer Lab 01", description: "Eastern Academic Block — 3rd Floor AV computer lab. Sheet CL-01 (27 seats).", capacity: 27, allowedRoles: ALL, maxMinutes: null },
    { key: "eab-cl02", building: "EAB", name: "Computer Lab 02", description: "Eastern Academic Block — 3rd Floor AV computer lab. Sheet CL-02 (27 seats).", capacity: 27, allowedRoles: ALL, maxMinutes: null },
    { key: "eab-cr-a206", building: "EAB", name: "60-Seater Classroom A-206", description: "Eastern Academic Block — 1st Floor Room A-206. Sheet CR-A206 60-Seater A-206 (25 seats).", capacity: 25, allowedRoles: ALL, maxMinutes: null },
    { key: "eab-cr-c206", building: "EAB", name: "60-Seater Classroom C-206", description: "Eastern Academic Block — 1st Floor Room C-206. Sheet CR-C206 60-Seater C-206 (25 seats).", capacity: 25, allowedRoles: ALL, maxMinutes: null },
    { key: "eab-cr-a306", building: "EAB", name: "60-Seater Classroom A-306", description: "Eastern Academic Block — 2nd Floor Room A-306. Sheet CR-A306 60-Seater A-306 (25 seats).", capacity: 25, allowedRoles: ALL, maxMinutes: null },
    { key: "eab-br", building: "EAB", name: "Board Room (4F)", description: "Eastern Academic Block — 4th Floor board room. Sheet BR Board Room (4F) (21 seats).", capacity: 21, allowedRoles: ALL, maxMinutes: null },
    { key: "eab-aud", building: "EAB", name: "Auditorium (4F)", description: "Eastern Academic Block — 4th Floor auditorium. Sheet AUD Auditorium (4F) (45 seats).", capacity: 45, allowedRoles: ALL, maxMinutes: null },
  ];

  for (const f of facilities) {
    const buildingId = buildingIds[f.building];
    if (!buildingId) continue;
    const existing = await prisma.facility.findFirst({ where: { name: f.name, buildingId } });
    if (existing) {
      await prisma.facility.update({
        where: { id: existing.id },
        data: { description: f.description, capacity: f.capacity, allowedRoles: [...f.allowedRoles], maxMinutes: f.maxMinutes },
      });
      if (f.maxMinutes === null) await prisma.facilityRoleLimit.deleteMany({ where: { facilityId: existing.id } });
    } else {
      await prisma.facility.create({
        data: {
          buildingId,
          name: f.name,
          description: f.description,
          capacity: f.capacity,
          allowedRoles: [...f.allowedRoles],
          maxMinutes: f.maxMinutes,
        },
      });
    }
  }
  console.log(`  facilities: ${facilities.length}`);

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
