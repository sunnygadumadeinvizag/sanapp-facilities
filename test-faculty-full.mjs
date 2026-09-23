import "dotenv/config";
import { SignJWT } from "jose";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./src/generated/prisma/client.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const SECRET = new TextEncoder().encode(process.env.APP_SESSION_SECRET);
const ISSUER = "sanapp-facilities";

async function createSess({ sub, username, name, email, role, primaryRole, ssoRole }) {
  return new SignJWT({ username, name, email, role, primaryRole, ssoRole })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(SECRET);
}

const BASE = process.env.APP_BASE_URL || "http://localhost:3005/facilities";

async function api(path, { method="GET", body=null, token=null, isForm=false }={}) {
  const headers={};
  if(token) headers["Cookie"]=`app4_session=${token}`;
  let b;
  if(body){
    if(isForm){ b=body; /* FormData sets content-type */ }
    else { headers["content-type"]="application/json"; b=JSON.stringify(body); }
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body:b });
  const text = await res.text();
  let json=null; try{ json=JSON.parse(text);}catch{}
  return { status: res.status, json, text: text.slice(0,1200) };
}

function istNow(){
  const off=5.5*3600*1000;
  const d=new Date(Date.now()+off);
  return d;
}
function istDateKey(d=istNow()){ return d.toISOString().slice(0,10); }
function istMinute(d=istNow()){ return d.getUTCHours()*60+d.getUTCMinutes(); }
function addDays(k,n){ const d=new Date(k+"T00:00:00Z"); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); }
function fmt(m){ return String(Math.floor(m/60)).padStart(2,"0")+":"+String(m%60).padStart(2,"0"); }

async function main(){
  console.log("=== FACULTY FULL TEST (kiran = STAFF_TEACHING faculty) ===");
  console.log("Base:",BASE," IST now:",istDateKey(),fmt(istMinute()));

  const facility = await prisma.facility.findFirst({ where:{ active:true }, include:{ building:true, roleLimits:true }});
  const building = facility.building;
  console.log(`\nFacility under test: ${facility.name} (${building.name}) id=${facility.id}`);
  console.log(` allowedRoles=${JSON.stringify(facility.allowedRoles)} buildingMax=${building.maxMinutes} facilityMax=${facility.maxMinutes}`);

  const facilities = await prisma.facility.findMany({ where:{ active:true }, include:{ building:true }});
  // find one open to all for faculty test (Guest Lounge / Gym)
  const openFacility = facilities.find(f=>f.allowedRoles.length===0) || facility;
  console.log(`Open facility: ${openFacility.name} (${openFacility.buildingId})`);

  const restrictedFacility = facilities.find(f=>f.allowedRoles.length>0) || null;
  if(restrictedFacility) console.log(`Restricted facility: ${restrictedFacility.name} allowed=${restrictedFacility.allowedRoles}`);

  const users = await prisma.appUser.findMany();
  const byName = Object.fromEntries(users.map(u=>[u.username,u]));
  const kiranApp = byName["kiran"];
  const sanyasiApp = byName["sanyasi"];
  const logisticsApp = byName["logistics"];
  const lakshmiApp = byName["lakshmi"];
  const rameshApp = byName["ramesh"];

  // fetch SSO ids
  const { Client } = await import("pg");
  const sso = new Client({ connectionString:"postgresql://sso_user:sso_dev_password@localhost:5432/sanapp_sso_db" });
  await sso.connect();
  const ssoRows = await sso.query('select id, username, "primaryRole", role from "User" where username in ($1,$2,$3,$4,$5,$6)', ["kiran","sanyasi","logistics","lakshmi","ramesh","geeta"]);
  const ssoMap = new Map(ssoRows.rows.map(r=>[r.username,r]));
  await sso.end();

  const kiranSso = ssoMap.get("kiran");
  const sanyasiSso = ssoMap.get("sanyasi");
  const logisticsSso = ssoMap.get("logistics");

  const kiranToken = await createSess({ sub:kiranSso.id, username:"kiran", name:"Kiran Rao", email:"", role: kiranApp.role, primaryRole: kiranSso.primaryRole, ssoRole:"USER" });
  const sanyasiToken = await createSess({ sub:sanyasiSso.id, username:"sanyasi", name:"Sanyasi Naidu", email:"", role: sanyasiApp.role, primaryRole: sanyasiSso.primaryRole, ssoRole:"USER" });
  const logisticsToken = logisticsSso ? await createSess({ sub:logisticsSso.id, username:"logistics", name:"Mr. Appala Murthy N", email:"", role: logisticsApp.role, primaryRole: logisticsSso.primaryRole, ssoRole:"USER" }) : null;

  console.log(`\nTokens created for kiran (role ${kiranApp.role} / ${kiranSso.primaryRole}), sanyasi (${sanyasiApp.role}), logistics (${logisticsApp?.role})`);

  // helper to pick future slot
  const tomorrow = addDays(istDateKey(), 1);
  const dayAfter = addDays(istDateKey(), 2);
  // find a free 30-min slot tomorrow 10:00-10:30 IST (600-630)
  let startMin = 600, endMin = 630;
  // ensure not in past and not conflicting
  // scan bookings for openFacility tomorrow
  const existing = await prisma.booking.findMany({ where:{ facilityId: openFacility.id, date: tomorrow, status:"CONFIRMED" }});
  console.log(`\nExisting CONFIRMED bookings for ${openFacility.name} on ${tomorrow}: ${existing.length}`);
  // pick a free window 10:00-11:00 else shift
  for(let s= 540; s<= 1200; s+=30){
    const e=s+30;
    const overlap = existing.some(b=> !(e<=b.startMin || s>=b.endMin));
    if(!overlap){ startMin=s; endMin=e; break; }
  }
  console.log(`Chosen slot: ${tomorrow} ${fmt(startMin)}-${fmt(endMin)}`);

  // clean up any previous test bookings for kiran on tomorrow (cancel remaining)
  const prev = await prisma.booking.findMany({ where:{ facilityId: openFacility.id, date: tomorrow, userId: kiranApp.id, status:"CONFIRMED" }});
  if(prev.length){ console.log(`Cleaning ${prev.length} leftover bookings`); for(const b of prev) await prisma.booking.update({ where:{id:b.id}, data:{ status:"CANCELLED", cancelledAt:new Date(), cancelledById:kiranApp.id, cancelReason:"cleanup" }}); }

  const results=[]; function log(name, ok, detail=""){ const icon=ok?"✅":"❌"; console.log(`${icon} ${name}${detail?" — "+detail:""}`); results.push({name,ok,detail}); }

  // 1. SELF booking as faculty (kiran) — should succeed on open facility
  {
    const fd=new FormData();
    fd.set("facilityId", openFacility.id);
    fd.set("startDate", tomorrow); fd.set("endDate", tomorrow);
    fd.set("startMin", String(startMin)); fd.set("endMin", String(endMin));
    const r=await api("/api/bookings",{method:"POST", body:fd, token:kiranToken, isForm:true});
    log("FACULTY SELF BOOKING (kiran, open facility, 30min)", r.status===201, `status=${r.status} ${r.json?.error||r.json?.message||""} ${r.text.slice(0,200)}`);
    var selfId = r.json?.booking?.id || null;
  }

  // 2. Duplicate/overlap should be rejected (409 or 400)
  {
    const fd2=new FormData(); fd2.set("facilityId",openFacility.id); fd2.set("startDate",tomorrow); fd2.set("endDate",tomorrow); fd2.set("startMin",String(startMin)); fd2.set("endMin",String(endMin));
    const r=await api("/api/bookings",{method:"POST", body:fd2, token:kiranToken, isForm:true});
    log("OVERLAP REJECTION (same slot)", r.status===409 || r.status===400, `status=${r.status} ${r.json?.error||""}`);
  }

  // 3. Minimum duration (<15) rejected
  {
    const r=await api("/api/bookings",{method:"POST", body:{facilityId:openFacility.id, startDate:tomorrow, endDate:tomorrow, startMin: startMin, endMin: startMin+10}, token:kiranToken});
    log("MIN DURATION 10min REJECTED", r.status===400, `status=${r.status} ${r.json?.error||""}`);
  }

  // 4. Edit booking — shift by 30min (should succeed)
  let edited=false;
  if(selfId){
    const newStart=startMin+60, newEnd=endMin+60;
    // ensure free
    const r=await api("/api/bookings",{method:"PATCH", body:{id:selfId, startDate:tomorrow, endDate:tomorrow, startMin:newStart, endMin:newEnd}, token:kiranToken});
    log("EDIT BOOKING (kiran moves own slot +60min)", r.status===200, `status=${r.status} ${r.json?.error||r.json?.message||""}`);
    edited = r.status===200;
    if(edited){ startMin=newStart; endMin=newEnd; }
    // edit to past should be rejected — try yesterday
    const yesterday=addDays(istDateKey(), -1);
    const r2=await api("/api/bookings",{method:"PATCH", body:{id:selfId, startDate:yesterday, endDate:yesterday, startMin:600, endMin:630}, token:kiranToken});
    log("EDIT TO PAST REJECTED", r2.status===400 || r2.status===409, `status=${r2.status} ${r2.json?.error||""}`);
    // edit to overlapping slot (create another then try to collide) — need second slot
    const fd3=new FormData(); fd3.set("facilityId",openFacility.id); fd3.set("startDate",tomorrow); fd3.set("endDate",tomorrow); fd3.set("startMin",String(startMin+120)); fd3.set("endMin",String(endMin+120));
    const r3=await api("/api/bookings",{method:"POST", body:fd3, token:kiranToken, isForm:true});
    let secondId=r3.json?.booking?.id;
    if(secondId){
      const r4=await api("/api/bookings",{method:"PATCH", body:{id:selfId, startDate:tomorrow, endDate:tomorrow, startMin:startMin+120, endMin:endMin+120}, token:kiranToken});
      log("EDIT TO OVERLAP REJECTED", r4.status===409 || r4.status===400, `status=${r4.status} ${r4.json?.error||""}`);
      // cleanup second
      await api(`/api/bookings?id=${secondId}`,{method:"DELETE", token:kiranToken});
    }
  } else {
    log("EDIT BOOKING (skipped — no selfId)","false","no booking created");
  }

  // 5. Cancel own booking
  if(selfId){
    const r=await api(`/api/bookings?id=${selfId}`,{method:"DELETE", token:kiranToken});
    log("CANCEL OWN BOOKING (kiran)", r.status===200 && r.json?.cancelled?.includes(selfId), `status=${r.status} ${JSON.stringify(r.json)}`);
    const row=await prisma.booking.findUnique({where:{id:selfId}});
    log("CANCEL PERSISTED (status=CANCELLED)", row?.status==="CANCELLED", `status=${row?.status}`);
  }

  // 6. Bulk create 2 slots with same batchId then bulk cancel
  {
    const batch = `test-${Date.now()}`;
    const s1 = 700, e1=730, s2=740, e2=770;
    // clean any overlap
    for(const b of await prisma.booking.findMany({where:{facilityId:openFacility.id, date:tomorrow, status:"CONFIRMED"}})){
      if(!(e1<=b.startMin || s1>=b.endMin) || !(e2<=b.startMin || s2>=b.endMin)){
        await prisma.booking.update({where:{id:b.id}, data:{status:"CANCELLED", cancelledAt:new Date(), cancelledById:kiranApp.id}});
      }
    }
    const fdA=new FormData(); fdA.set("facilityId",openFacility.id); fdA.set("batchId",batch); fdA.set("startDate",tomorrow); fdA.set("endDate",tomorrow); fdA.set("startMin",String(s1)); fdA.set("endMin",String(e1));
    const fdB=new FormData(); fdB.set("facilityId",openFacility.id); fdB.set("batchId",batch); fdB.set("startDate",tomorrow); fdB.set("endDate",tomorrow); fdB.set("startMin",String(s2)); fdB.set("endMin",String(e2));
    const ra=await api("/api/bookings",{method:"POST", body:fdA, token:kiranToken, isForm:true});
    const rb=await api("/api/bookings",{method:"POST", body:fdB, token:kiranToken, isForm:true});
    const idA=ra.json?.booking?.id, idB=rb.json?.booking?.id;
    log("BULK CREATE 2 slots (same batchId)", ra.status===201 && rb.status===201, `ids=${idA?.slice(0,6)},${idB?.slice(0,6)}`);
    if(idA && idB){
      const rc=await api(`/api/bookings?id=${idA},${idB}&reason=bulk-test`,{method:"DELETE", token:kiranToken});
      log("BULK CANCEL 2 slots", rc.status===200 && rc.json?.cancelled?.length===2, `cancelled=${rc.json?.cancelled?.length} ${JSON.stringify(rc.json)}`);
    }
  }

  // 7. POC ON_BEHALF booking — kiran (non-POC) should be FORBIDDEN (403)
  {
    const sso2 = await prisma.appUser.findUnique({where:{username:"ramesh"}});
    const fd=new FormData(); fd.set("facilityId", openFacility.id); fd.set("startDate",dayAfter); fd.set("endDate",dayAfter); fd.set("startMin","600"); fd.set("endMin","660"); fd.set("purpose","On-behalf test for ramesh"); fd.set("forUserId", sso2.id);
    const r=await api("/api/bookings",{method:"POST", body:fd, token:kiranToken, isForm:true});
    log("POC ON_BEHALF by NON-POC (kiran) should FAIL 403", r.status===403, `status=${r.status} ${r.json?.error||""}`);
  }

  // 8. POC ON_BEHALF by actual POC (logistics is POC of EAB / Seminar Hall-1)
  {
    if(logisticsToken){
      // Seminar Hall-1 is the facility where logistics is POC
      const eabFacility = await prisma.facility.findFirst({ where:{ name:{ contains:"Seminar Hall-1" }}});
      const targetFacility = eabFacility || openFacility;
      const forUser = await prisma.appUser.findUnique({ where:{ username:"ramesh" }});
      // clean
      for(const b of await prisma.booking.findMany({where:{facilityId:targetFacility.id, date:dayAfter, status:"CONFIRMED"}})){
        if(b.startMin===600) await prisma.booking.update({where:{id:b.id}, data:{status:"CANCELLED", cancelledAt:new Date(), cancelledById:logisticsApp.id}});
      }
      const fd=new FormData(); fd.set("facilityId", targetFacility.id); fd.set("startDate",dayAfter); fd.set("endDate",dayAfter); fd.set("startMin","600"); fd.set("endMin","660"); fd.set("purpose","POC block for student meeting"); fd.set("forUserId", forUser.id);
      const r=await api("/api/bookings",{method:"POST", body:fd, token:logisticsToken, isForm:true});
      log("POC ON_BEHALF by logistics (POC) should SUCCEED 201", r.status===201 && r.json?.booking?.type==="ON_BEHALF", `status=${r.status} type=${r.json?.booking?.type} ${r.json?.error||""}`);
      let onBehalfId=r.json?.booking?.id;
      if(onBehalfId){
        // the forUser should be able to cancel their own blocked slot
        const rameshSso = ssoMap.get("ramesh");
        const rameshToken = await createSess({ sub:rameshSso.id, username:"ramesh", name:"Ramesh Kumar", email:"", role:"USER", primaryRole:rameshSso.primaryRole, ssoRole:"USER" });
        const rc=await api(`/api/bookings?id=${onBehalfId}`,{method:"DELETE", token:rameshToken});
        log("FOR-USER can cancel their own ON_BEHALF slot", rc.status===200 && rc.json?.cancelled?.includes(onBehalfId), `status=${rc.status}`);
        if(!(rc.json?.cancelled?.includes(onBehalfId))){
          await api(`/api/bookings?id=${onBehalfId}`,{method:"DELETE", token:logisticsToken});
        }
      }
      // ON_BEHALF without purpose should fail
      const fd2=new FormData(); fd2.set("facilityId", targetFacility.id); fd2.set("startDate",dayAfter); fd2.set("endDate",dayAfter); fd2.set("startMin","700"); fd2.set("endMin","760"); fd2.set("forUserId", forUser.id);
      const r2=await api("/api/bookings",{method:"POST", body:fd2, token:logisticsToken, isForm:true});
      log("ON_BEHALF without purpose REJECTED", r2.status===400, `status=${r2.status} ${r2.json?.error||""}`);
    } else {
      log("POC ON_BEHALF tests","false","no logistics token");
    }
  }

  // 9. LONG booking (>3h) — only POC can, on own name, description required
  {
    // kiran non-POC tries 4h → should be 403
    const fd=new FormData(); fd.set("facilityId", openFacility.id); fd.set("startDate",dayAfter); fd.set("endDate",dayAfter); fd.set("startMin","600"); fd.set("endMin","840"); fd.set("purpose","4h event");
    const r=await api("/api/bookings",{method:"POST", body:fd, token:kiranToken, isForm:true});
    log("LONG 4h by NON-POC (kiran) should FAIL 403", r.status===403, `status=${r.status} ${r.json?.error||""}`);
    if(logisticsToken){
      const eabFacility = await prisma.facility.findFirst({ where:{ name:{ contains:"Seminar Hall-1" }}});
      const targetFacility = eabFacility || openFacility;
      // clean long slot
      for(const b of await prisma.booking.findMany({where:{facilityId:targetFacility.id, date:dayAfter, status:"CONFIRMED"}})){
        if(b.startMin===540) await prisma.booking.update({where:{id:b.id}, data:{status:"CANCELLED", cancelledAt:new Date(), cancelledById:logisticsApp.id}});
      }
      const fd2=new FormData(); fd2.set("facilityId", targetFacility.id); fd2.set("startDate",dayAfter); fd2.set("endDate",dayAfter); fd2.set("startMin","540"); fd2.set("endMin","780"); fd2.set("purpose","POC long block 4h workshop");
      const r2=await api("/api/bookings",{method:"POST", body:fd2, token:logisticsToken, isForm:true});
      // EAB facility has max 300min cap, so 240min should succeed but 300+ may be capped
      log("LONG 4h by POC (logistics) on EAB (cap 300) → expect 201", r2.status===201 && r2.json?.booking?.type==="LONG", `status=${r2.status} type=${r2.json?.booking?.type} ${r2.json?.error||""}`);
      if(r2.json?.booking?.id) await api(`/api/bookings?id=${r2.json.booking.id}`,{method:"DELETE", token:logisticsToken});
      // LONG without purpose rejected
      const fd3=new FormData(); fd3.set("facilityId", targetFacility.id); fd3.set("startDate",dayAfter); fd3.set("endDate",dayAfter); fd3.set("startMin","540"); fd3.set("endMin","780");
      const r3=await api("/api/bookings",{method:"POST", body:fd3, token:logisticsToken, isForm:true});
      log("LONG without purpose REJECTED", r3.status===400, `status=${r3.status} ${r3.json?.error||""}`);
    }
  }

  // 10. Configurable maxMinutes — EAB Seminar Hall-1 has facility max 300 (5h). Test exceeding cap.
  {
    if(logisticsToken){
      const fac300 = await prisma.facility.findFirst({ where:{ name:{ contains:"Seminar Hall-1" }}});
      if(fac300){
        const fd=new FormData(); fd.set("facilityId", fac300.id); fd.set("startDate",dayAfter); fd.set("endDate",dayAfter); fd.set("startMin","600"); fd.set("endMin","965"); fd.set("purpose","exceed 300min cap"); // 365 min >300
        const r=await api("/api/bookings",{method:"POST", body:fd, token:logisticsToken, isForm:true});
        log("EXCEED FACILITY MAX 300min REJECTED", r.status===400, `status=${r.status} ${r.json?.error||""}`);
      }
    }
  }

  // 11. Eligibility — ramesh is STUDENT, should be blocked from STAFF-only Board Room, allowed on open/all
  {
    const staffOnly = await prisma.facility.findFirst({ where:{ allowedRoles:{ has:"STAFF_TEACHING" }, active:true, building:{ active:true }}});
    // ensure it's staff-only (no STUDENT)
    if(staffOnly && !staffOnly.allowedRoles.includes("STUDENT")){
      const rameshSso = ssoMap.get("ramesh");
      const rameshToken2 = await createSess({ sub:rameshSso.id, username:"ramesh", name:"Ramesh Kumar", email:"", role:"USER", primaryRole:rameshSso.primaryRole, ssoRole:"USER" });
      // clean
      for(const b of await prisma.booking.findMany({where:{facilityId:staffOnly.id, date:dayAfter, status:"CONFIRMED"}})){
        if(b.userId=== (await prisma.appUser.findUnique({where:{username:"ramesh"}})).id)
          await prisma.booking.update({where:{id:b.id}, data:{status:"CANCELLED", cancelledAt:new Date()}});
      }
      const fd=new FormData(); fd.set("facilityId", staffOnly.id); fd.set("startDate",dayAfter); fd.set("endDate",dayAfter); fd.set("startMin","600"); fd.set("endMin","630");
      const r=await api("/api/bookings",{method:"POST", body:fd, token:rameshToken2, isForm:true});
      log(`ELIGIBILITY STUDENT ramesh on STAFF-only ${staffOnly.name} → REJECTED 403`, r.status===403, `status=${r.status} ${r.json?.error||""}`);
      // kiran is STAFF_TEACHING → should succeed on same facility
      const fd2=new FormData(); fd2.set("facilityId", staffOnly.id); fd2.set("startDate",dayAfter); fd2.set("endDate",dayAfter); fd2.set("startMin","700"); fd2.set("endMin","730");
      const r2=await api("/api/bookings",{method:"POST", body:fd2, token:kiranToken, isForm:true});
      log(`ELIGIBILITY STAFF_TEACHING kiran on same STAFF-only facility → ALLOWED 201`, r2.status===201, `status=${r2.status} ${r2.json?.error||""}`);
      if(r2.json?.booking?.id) await api(`/api/bookings?id=${r2.json.booking.id}`,{method:"DELETE", token:kiranToken});
      // ADMIN bypasses — sanyasi is ADMIN
      const fd3=new FormData(); fd3.set("facilityId", staffOnly.id); fd3.set("startDate",dayAfter); fd3.set("endDate",dayAfter); fd3.set("startMin","800"); fd3.set("endMin","830");
      const r3=await api("/api/bookings",{method:"POST", body:fd3, token:sanyasiToken, isForm:true});
      log(`ELIGIBILITY ADMIN sanyasi on STAFF-only → ALLOWED (bypass)`, r3.status===201, `status=${r3.status} ${r3.json?.error||""}`);
      if(r3.json?.booking?.id) await api(`/api/bookings?id=${r3.json.booking.id}`,{method:"DELETE", token:sanyasiToken});
    }
  }

  // 12. PDF attachment (mock) — create with pdf, verify pdf flag
  {
    const pdfBytes = Buffer.from("%PDF-1.4 mock pdf content");
    const blob = new Blob([pdfBytes], { type:"application/pdf" });
    const fd=new FormData(); fd.set("facilityId", openFacility.id); fd.set("startDate",dayAfter); fd.set("endDate",dayAfter); fd.set("startMin","800"); fd.set("endMin","830"); fd.set("purpose","with pdf"); fd.set("pdf", blob, "test.pdf");
    const r=await api("/api/bookings",{method:"POST", body:fd, token:kiranToken, isForm:true});
    log("SELF with PDF attachment (1MB <) → 201", r.status===201, `status=${r.status} pdf=${r.json?.booking?.pdfName||""} ${r.json?.error||""}`);
    if(r.json?.booking?.id){
      const bid=r.json.booking.id;
      // verify pdf download
      const dl=await api(`/api/bookings/${bid}/pdf`,{method:"GET", token:kiranToken});
      log("PDF download (inline pdf content-type)", dl.status===200, `status=${dl.status} len=${dl.text.length}`);
      await api(`/api/bookings?id=${bid}`,{method:"DELETE", token:kiranToken});
    }
    // oversized pdf — create 1.1 MB
    const big = new Blob([new Uint8Array(1100000)], { type:"application/pdf" });
    const fd2=new FormData(); fd2.set("facilityId", openFacility.id); fd2.set("startDate",dayAfter); fd2.set("endDate",dayAfter); fd2.set("startMin","830"); fd2.set("endMin","860"); fd2.set("purpose","big pdf"); fd2.set("pdf", big, "big.pdf");
    const r2=await api("/api/bookings",{method:"POST", body:fd2, token:kiranToken, isForm:true});
    log("OVERSIZED PDF (>1MB) REJECTED 400", r2.status===400, `status=${r2.status} ${r2.json?.error||""}`);
  }

  // 13. Past booking rejected
  {
    const yesterday=addDays(istDateKey(), -1);
    const fd=new FormData(); fd.set("facilityId", openFacility.id); fd.set("startDate",yesterday); fd.set("endDate",yesterday); fd.set("startMin","600"); fd.set("endMin","630");
    const r=await api("/api/bookings",{method:"POST", body:fd, token:kiranToken, isForm:true});
    log("PAST DATE BOOKING REJECTED", r.status===400, `status=${r.status} ${r.json?.error||""}`);
  }

  // 14. My bookings list + search + pagination (GET ?mine=1)
  {
    // create one to list
    const fd=new FormData(); fd.set("facilityId", openFacility.id); fd.set("startDate",dayAfter); fd.set("endDate",dayAfter); fd.set("startMin","900"); fd.set("endMin","930");
    const cr=await api("/api/bookings",{method:"POST", body:fd, token:kiranToken, isForm:true});
    const createdId=cr.json?.booking?.id;
    const r=await api("/api/bookings?mine=1",{method:"GET", token:kiranToken});
    log("GET mine=1 lists bookings", r.status===200 && Array.isArray(r.json?.bookings), `status=${r.status} count=${r.json?.bookings?.length}`);
    const r2=await api(`/api/bookings?mine=1&q=${encodeURIComponent(openFacility.name.slice(0,5))}`,{method:"GET", token:kiranToken});
    log("SEARCH mine q= substring", r2.status===200, `status=${r2.status} count=${r2.json?.bookings?.length}`);
    if(createdId) await api(`/api/bookings?id=${createdId}`,{method:"DELETE", token:kiranToken});
  }

  // 15. Calendar range query (facilityId + from/to)
  {
    const from=tomorrow, to=dayAfter;
    const r=await api(`/api/bookings?facilityId=${openFacility.id}&from=${from}&to=${to}`,{method:"GET", token:kiranToken});
    log("CALENDAR RANGE from/to query", r.status===200 && Array.isArray(r.json?.bookings), `status=${r.status} count=${r.json?.bookings?.length}`);
  }

  // 16. Cancel already-cancelled should be skipped, not re-cancel
  {
    const fd=new FormData(); fd.set("facilityId", openFacility.id); fd.set("startDate",dayAfter); fd.set("endDate",dayAfter); fd.set("startMin","920"); fd.set("endMin","950");
    const cr=await api("/api/bookings",{method:"POST", body:fd, token:kiranToken, isForm:true});
    const bid=cr.json?.booking?.id;
    if(bid){
      await api(`/api/bookings?id=${bid}`,{method:"DELETE", token:kiranToken});
      const r2=await api(`/api/bookings?id=${bid}`,{method:"DELETE", token:kiranToken});
      log("CANCEL already-cancelled → skipped", r2.status===200 && r2.json?.skipped?.length===1, `skipped=${JSON.stringify(r2.json?.skipped)}`);
    }
  }

  console.log("\n=== SUMMARY ===");
  const pass=results.filter(r=>r.ok).length, fail=results.filter(r=>!r.ok).length;
  console.log(`PASS ${pass}/${results.length}  FAIL ${fail}`);
  if(fail) { console.log("Failed:"); results.filter(r=>!r.ok).forEach(r=>console.log(" - "+r.name+" — "+r.detail)); }
  await prisma.$disconnect();
}

main().catch(e=>{console.error(e); process.exit(1)});
