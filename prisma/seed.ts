import "dotenv/config";
import { prisma } from "../src/lib/prisma";

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
  const buildings = [
    { name: "Main Academic Block", code: "MAB", description: "Classrooms, faculty cabins and the central lecture halls.", location: "Main Campus" },
    { name: "Library & Learning Centre", code: "LIB", description: "Reading halls, digital resource rooms and group study areas.", location: "Main Campus" },
    { name: "Administration Building", code: "ADM", description: "Administrative offices and meeting rooms.", location: "Main Campus" },
    { name: "Sports Complex", code: "SPT", description: "Indoor courts, gymnasium and multipurpose hall.", location: "North Campus" },
    { name: "Guest House", code: "GH", description: "Visitor accommodation and conference facilities.", location: "South Campus" },
  ] as const;

  const buildingIds: Record<string, string> = {};
  for (const [i, b] of buildings.entries()) {
    const row = await prisma.building.upsert({
      where: { id: `seed-${b.code}` },
      update: { name: b.name, code: b.code, description: b.description, location: b.location, order: i, active: true },
      create: { id: `seed-${b.code}`, name: b.name, code: b.code, description: b.description, location: b.location, order: i, active: true },
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

  const facilities = [
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
  ] as const;

  for (const f of facilities) {
    const buildingId = buildingIds[f.building];
    if (!buildingId) continue;
    const existing = await prisma.facility.findFirst({ where: { name: f.name, buildingId } });
    if (existing) {
      await prisma.facility.update({
        where: { id: existing.id },
        data: { description: f.description, capacity: f.capacity, allowedRoles: [...f.allowedRoles] },
      });
    } else {
      await prisma.facility.create({
        data: {
          buildingId,
          name: f.name,
          description: f.description,
          capacity: f.capacity,
          allowedRoles: [...f.allowedRoles],
        },
      });
    }
  }
  console.log(`  facilities: ${facilities.length}`);

  // ------------------------------------------------------------------
  // Logistics — vehicles & parking slots (managed further by the admin)
  // ------------------------------------------------------------------
  const vehicles = [
    { name: "Toyota Innova", type: "Car", registrationNo: "AP31 CN 1101", capacity: 6, driverName: "S. Raju", driverPhone: "98490 11001" },
    { name: "Maruti Ertiga", type: "Car", registrationNo: "AP31 CN 1102", capacity: 6, driverName: "K. Prasad", driverPhone: "98490 11002" },
    { name: "Mahindra Bolero", type: "Van", registrationNo: "AP31 CN 1103", capacity: 9, driverName: "M. Naidu", driverPhone: "98490 11003" },
    { name: "Force Traveller", type: "Bus", registrationNo: "AP31 CN 1104", capacity: 26, driverName: "V. Rao", driverPhone: "98490 11004" },
  ] as const;
  for (const v of vehicles) {
    await prisma.vehicle.upsert({
      where: { registrationNo: v.registrationNo },
      update: { name: v.name, type: v.type, capacity: v.capacity, driverName: v.driverName, driverPhone: v.driverPhone },
      create: { name: v.name, type: v.type, registrationNo: v.registrationNo, capacity: v.capacity, driverName: v.driverName, driverPhone: v.driverPhone },
    });
  }
  console.log(`  vehicles: ${vehicles.map((v) => v.registrationNo).join(", ")}`);

  const parkingSlots = [
    { name: "Block A — P1", area: "Main Campus", slotType: "RESERVED" },
    { name: "Block A — P2", area: "Main Campus", slotType: "GENERAL" },
    { name: "Block B — P1", area: "Main Campus", slotType: "GENERAL" },
    { name: "Guest House — G1", area: "South Campus", slotType: "RESERVED" },
    { name: "Sports Complex — S1", area: "North Campus", slotType: "GENERAL" },
  ] as const;
  for (const sp of parkingSlots) {
    const key = `${sp.area} / ${sp.name}`;
    const existing = await prisma.parkingSlot.findFirst({ where: { name: sp.name, area: sp.area } });
    if (existing) {
      await prisma.parkingSlot.update({ where: { id: existing.id }, data: { slotType: sp.slotType } });
    } else {
      await prisma.parkingSlot.create({ data: { name: sp.name, area: sp.area, slotType: sp.slotType } });
    }
  }
  console.log(`  parking slots: ${parkingSlots.length}`);


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
