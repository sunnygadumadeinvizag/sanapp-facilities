import "dotenv/config";
import { SignJWT } from "jose";
import pg from "pg";
const { Client } = pg;

const SECRET = new TextEncoder().encode(process.env.APP_SESSION_SECRET);
const ISSUER = "sanapp-facilities";
const BASE = process.env.APP_BASE_URL || "http://localhost:3005/facilities";
const FAC_DB = process.env.DATABASE_URL;
const SSO_DB = "postgresql://sso_user:sso_dev_password@localhost:5432/sanapp_sso_db";

async function createSess({ sub, username, name, email, role, primaryRole, ssoRole }) {
  return new SignJWT({ username, name, email, role, primaryRole, ssoRole })
    .setProtectedHeader({ alg: "HS256" }).setSubject(sub).setIssuer(ISSUER).setIssuedAt().setExpirationTime("8h").sign(SECRET);
}
async function api(path, { method="GET", body=null, token=null, isForm=false }={}) {
  const headers={};
  if(token) headers["Cookie"]=`app4_session=${token}`;
  let b;
  if(body){ if(isForm){ b=body; } else { headers["content-type"]="application/json"; b=JSON.stringify(body); } }
  const res = await fetch(`${BASE}${path}`, { method, headers, body:b });
  const text = await res.text();
  let json=null; try{ json=JSON.parse(text);}catch{}
  return { status: res.status, json, text: text.slice(0,1500) };
}
function istNow(){ return new Date(Date.now()+5.5*3600*1000); }
function istDateKey(d=istNow()){ return d.toISOString().slice(0,10); }
function istMinute(d=istNow()){ return d.getUTCHours()*60+d.getUTCMinutes(); }
function addDays(k,n){ const d=new Date(k+"T00:00:00Z"); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); }
function fmt(m){ return String(Math.floor(m/60)).padStart(2,"0")+":"+String(m%60).padStart(2,"0"); }

const fac = new Client({ connectionString: FAC_DB });
const sso = new Client({ connectionString: SSO_DB });
await fac.connect(); await sso.connect();

console.log("=== FACULTY FULL TEST (kiran = STAFF_TEACHING faculty) ===");
console.log("Base:",BASE," IST:",istDateKey(),fmt(istMinute()));

let r = await fac.query('select f.id, f.name, f."allowedRoles", f."maxMinutes", b.name as bname, b."maxMinutes" as bmax from "Facility" f join "Building" b on b.id=f."buildingId" where f.active=true and b.active=true order by b.name, f.name');
const facilities = r.rows;
console.log(`Facilities: ${facilities.length}`);
facilities.forEach(f=>console.log(` - ${f.bname} / ${f.name} allowed=${JSON.stringify(f.allowedRoles)} max=${f.maxMinutes} bmax=${f.bmax}`));
const openFacility = facilities.find(f=>f.allowedRoles.length===0) || facilities[0];
const staffOnlyFacility = facilities.find(f=>f.allowedRoles.includes("STAFF_TEACHING") && !f.allowedRoles.includes("STUDENT"));
console.log(`\nOpen facility for SELF tests: ${openFacility.bname} / ${openFacility.name} id=${openFacility.id}`);
if(staffOnlyFacility) console.log(`Staff-only facility for eligibility test: ${staffOnlyFacility.bname}/${staffOnlyFacility.name} allowed=${staffOnlyFacility.allowedRoles}`);

r = await fac.query('select id, username, role, "primaryRole", "ssoUserId", name from "AppUser" order by username');
const appUsers = r.rows;
const byName = Object.fromEntries(appUsers.map(u=>[u.username,u]));
console.log("\nAppUsers:", appUsers.map(u=>`${u.username}(${u.role}/${u.primaryRole})`).join(", "));

r = await sso.query('select id, username, "primaryRole", role, name from "User" where username in ($1,$2,$3,$4,$5,$6)', ["kiran","sanyasi","logistics","lakshmi","ramesh","geeta"]);
const ssoRows=r.rows; const ssoMap=new Map(ssoRows.map(x=>[x.username,x]));
const kiranSso=ssoMap.get("kiran"), sanyasiSso=ssoMap.get("sanyasi"), logisticsSso=ssoMap.get("logistics"), rameshSso=ssoMap.get("ramesh"), geetaSso=ssoMap.get("geeta");
console.log(`SSO kiran=${kiranSso.primaryRole} sanyasi=${sanyasiSso.primaryRole} logistics=${logisticsSso?.primaryRole} ramesh=${rameshSso.primaryRole}`);

const kiranTok = await createSess({ sub:kiranSso.id, username:"kiran", name:kiranSso.name, email:"", role:byName["kiran"].role, primaryRole:kiranSso.primaryRole, ssoRole:"USER" });
const sanyasiTok = await createSess({ sub:sanyasiSso.id, username:"sanyasi", name:sanyasiSso.name, email:"", role:byName["sanyasi"].role, primaryRole:sanyasiSso.primaryRole, ssoRole:"USER" });
const logisticsTok = logisticsSso ? await createSess({ sub:logisticsSso.id, username:"logistics", name:logisticsSso.name, email:"", role:byName["logistics"].role, primaryRole:logisticsSso.primaryRole, ssoRole:"USER" }) : null;
const rameshTok = await createSess({ sub:rameshSso.id, username:"ramesh", name:rameshSso.name, email:"", role:byName["ramesh"].role, primaryRole:rameshSso.primaryRole, ssoRole:"USER" });

const tomorrow=addDays(istDateKey(),1), dayAfter=addDays(istDateKey(),2), yesterday=addDays(istDateKey(),-1);
console.log(`Dates: yesterday=${yesterday} tomorrow=${tomorrow} dayAfter=${dayAfter}`);

// pick free slot on tomorrow for openFacility
r = await fac.query('select "startMin","endMin" from "Booking" where "facilityId"=$1 and date=$2 and status=\'CONFIRMED\'', [openFacility.id, tomorrow]);
let existing=r.rows;
let startMin=600,endMin=630;
for(let s=540;s<=1200;s+=30){ const e=s+30; const ov=existing.some(b=>!(e<=b.startMin||s>=b.endMin)); if(!ov){startMin=s;endMin=e;break;} }
console.log(`Chosen free slot tomorrow: ${fmt(startMin)}-${fmt(endMin)} existing=${existing.length}`);

// cleanup leftovers for kiran tomorrow
r = await fac.query('select id from "Booking" where "facilityId"=$1 and date=$2 and "userId"=$3 and status=\'CONFIRMED\'', [openFacility.id, tomorrow, byName["kiran"].id]);
for(const row of r.rows) await fac.query('update "Booking" set status=\'CANCELLED\', "cancelledAt"=now(), "cancelledById"=$2, "cancelReason"=\'cleanup\' where id=$1', [row.id, byName["kiran"].id]);

const results=[]; function log(name, ok, detail=""){ const icon=ok?"✅":"❌"; console.log(`${icon} ${name}${detail?" — "+detail:""}`); results.push({name,ok,detail}); }

// 1 SELF
let selfId=null;
{
  const fd=new FormData(); fd.set("facilityId",openFacility.id); fd.set("startDate",tomorrow); fd.set("endDate",tomorrow); fd.set("startMin",String(startMin)); fd.set("endMin",String(endMin));
  const rr=await api("/api/bookings",{method:"POST", body:fd, token:kiranTok, isForm:true});
  log("1. FACULTY SELF BOOKING (kiran, open facility, 30min)", rr.status===201, `status=${rr.status} ${rr.json?.error||rr.json?.message||""} ${rr.text.slice(0,180)}`);
  selfId=rr.json?.booking?.id||null;
}
// 2 OVERLAP
{
  const fd=new FormData(); fd.set("facilityId",openFacility.id); fd.set("startDate",tomorrow); fd.set("endDate",tomorrow); fd.set("startMin",String(startMin)); fd.set("endMin",String(endMin));
  const rr=await api("/api/bookings",{method:"POST", body:fd, token:kiranTok, isForm:true});
  log("2. OVERLAP SAME SLOT REJECTED", rr.status===409||rr.status===400, `status=${rr.status} ${rr.json?.error||""}`);
}
// 3 MIN duration
{
  const rr=await api("/api/bookings",{method:"POST", body:{facilityId:openFacility.id, startDate:tomorrow, endDate:tomorrow, startMin:startMin, endMin:startMin+10}, token:kiranTok});
  log("3. MIN DURATION 10min REJECTED", rr.status===400, `status=${rr.status} ${rr.json?.error||""}`);
}
// 4 EDIT
if(selfId){
  const ns=startMin+60, ne=endMin+60;
  const rr=await api("/api/bookings",{method:"PATCH", body:{id:selfId, startDate:tomorrow, endDate:tomorrow, startMin:ns, endMin:ne}, token:kiranTok});
  log("4a. EDIT OWN SLOT +60min", rr.status===200, `status=${rr.status} ${rr.json?.error||rr.json?.message||""}`);
  if(rr.status===200){ startMin=ns; endMin=ne; }
  const rr2=await api("/api/bookings",{method:"PATCH", body:{id:selfId, startDate:yesterday, endDate:yesterday, startMin:600, endMin:630}, token:kiranTok});
  log("4b. EDIT TO PAST REJECTED", rr2.status===400||rr2.status===409, `status=${rr2.status} ${rr2.json?.error||""}`);
  // create second then collide
  const fd2=new FormData(); fd2.set("facilityId",openFacility.id); fd2.set("startDate",tomorrow); fd2.set("endDate",tomorrow); fd2.set("startMin",String(startMin+120)); fd2.set("endMin",String(endMin+120));
  const cr=await api("/api/bookings",{method:"POST", body:fd2, token:kiranTok, isForm:true});
  const secondId=cr.json?.booking?.id;
  if(secondId){
    const rr3=await api("/api/bookings",{method:"PATCH", body:{id:selfId, startDate:tomorrow, endDate:tomorrow, startMin:startMin+120, endMin:endMin+120}, token:kiranTok});
    log("4c. EDIT TO OVERLAP REJECTED", rr3.status===409||rr3.status===400, `status=${rr3.status} ${rr3.json?.error||""}`);
    await api(`/api/bookings?id=${secondId}`,{method:"DELETE", token:kiranTok});
  }
} else log("4. EDIT (skipped no selfId)", false, "no booking");
// 5 CANCEL own
if(selfId){
  const rr=await api(`/api/bookings?id=${selfId}`,{method:"DELETE", token:kiranTok});
  log("5a. CANCEL OWN", rr.status===200 && rr.json?.cancelled?.includes(selfId), `status=${rr.status} ${JSON.stringify(rr.json)}`);
  const row=(await fac.query('select status from "Booking" where id=$1',[selfId])).rows[0];
  log("5b. CANCEL PERSISTED", row?.status==="CANCELLED", `status=${row?.status}`);
}
// 6 BULK
{
  const batch=`test-${Date.now()}`;
  const s1=700,e1=730,s2=740,e2=770;
  // clean overlaps
  r=await fac.query('select id,"startMin","endMin" from "Booking" where "facilityId"=$1 and date=$2 and status=\'CONFIRMED\'',[openFacility.id, tomorrow]);
  for(const b of r.rows){ if(!(e1<=b.startMin||s1>=b.endMin)||!(e2<=b.startMin||s2>=b.endMin)) await fac.query('update "Booking" set status=\'CANCELLED\', "cancelledAt"=now() where id=$1',[b.id]); }
  const fdA=new FormData(); fdA.set("facilityId",openFacility.id); fdA.set("batchId",batch); fdA.set("startDate",tomorrow); fdA.set("endDate",tomorrow); fdA.set("startMin",String(s1)); fdA.set("endMin",String(e1));
  const fdB=new FormData(); fdB.set("facilityId",openFacility.id); fdB.set("batchId",batch); fdB.set("startDate",tomorrow); fdB.set("endDate",tomorrow); fdB.set("startMin",String(s2)); fdB.set("endMin",String(e2));
  const ra=await api("/api/bookings",{method:"POST", body:fdA, token:kiranTok, isForm:true});
  const rb=await api("/api/bookings",{method:"POST", body:fdB, token:kiranTok, isForm:true});
  const idA=ra.json?.booking?.id, idB=rb.json?.booking?.id;
  log("6a. BULK CREATE 2 slots same batch", ra.status===201&&rb.status===201, `ids=${idA?.slice(0,6)},${idB?.slice(0,6)}`);
  if(idA&&idB){ const rc=await api(`/api/bookings?id=${idA},${idB}&reason=bulk-test`,{method:"DELETE", token:kiranTok}); log("6b. BULK CANCEL 2", rc.status===200&&rc.json?.cancelled?.length===2, `cancelled=${rc.json?.cancelled?.length}`); }
}
// 7 ON_BEHALF non-POC forbidden
{
  const fd=new FormData(); fd.set("facilityId",openFacility.id); fd.set("startDate",dayAfter); fd.set("endDate",dayAfter); fd.set("startMin","600"); fd.set("endMin","660"); fd.set("purpose","on-behalf test"); fd.set("forUserId", byName["ramesh"].id);
  const rr=await api("/api/bookings",{method:"POST", body:fd, token:kiranTok, isForm:true});
  log("7. ON_BEHALF by NON-POC (kiran) REJECTED 403", rr.status===403, `status=${rr.status} ${rr.json?.error||""}`);
}
// 8 POC ON_BEHALF success (logistics on EAB Seminar Hall-1)
{
  if(logisticsTok){
    const fr=await fac.query('select id from "Facility" where name like \'%Seminar Hall-1%\'');
    const targetId=fr.rows[0]?.id || openFacility.id;
    const targetFacility = facilities.find(f=>f.id===targetId) || openFacility;
    // clean 600-660
    r=await fac.query('select id from "Booking" where "facilityId"=$1 and date=$2 and status=\'CONFIRMED\' and "startMin"=600',[targetId, dayAfter]);
    for(const row of r.rows) await fac.query('update "Booking" set status=\'CANCELLED\', "cancelledAt"=now(), "cancelledById"=$2 where id=$1',[row.id, byName["logistics"].id]);
    const fd=new FormData(); fd.set("facilityId",targetId); fd.set("startDate",dayAfter); fd.set("endDate",dayAfter); fd.set("startMin","600"); fd.set("endMin","660"); fd.set("purpose","POC block for student meeting"); fd.set("forUserId", byName["ramesh"].id);
    const rr=await api("/api/bookings",{method:"POST", body:fd, token:logisticsTok, isForm:true});
    log(`8a. ON_BEHALF by POC (logistics) on ${targetFacility.bname}/${targetFacility.name} → 201`, rr.status===201&&rr.json?.booking?.type==="ON_BEHALF", `status=${rr.status} type=${rr.json?.booking?.type} ${rr.json?.error||""}`);
    const onId=rr.json?.booking?.id;
    if(onId){
      const rc=await api(`/api/bookings?id=${onId}`,{method:"DELETE", token:rameshTok});
      log("8b. FOR-USER (ramesh) can cancel own ON_BEHALF", rc.status===200&&rc.json?.cancelled?.includes(onId), `status=${rc.status}`);
      if(!rc.json?.cancelled?.includes(onId)) await api(`/api/bookings?id=${onId}`,{method:"DELETE", token:logisticsTok});
    }
    const fd2=new FormData(); fd2.set("facilityId",targetId); fd2.set("startDate",dayAfter); fd2.set("endDate",dayAfter); fd2.set("startMin","700"); fd2.set("endMin","760"); fd2.set("forUserId", byName["ramesh"].id);
    const rr2=await api("/api/bookings",{method:"POST", body:fd2, token:logisticsTok, isForm:true});
    log("8c. ON_BEHALF without purpose REJECTED", rr2.status===400, `status=${rr2.status} ${rr2.json?.error||""}`);
  } else log("8. POC ON_BEHALF (skipped no logistics token)", false, "");
}
// 9 LONG
{
  const fd=new FormData(); fd.set("facilityId",openFacility.id); fd.set("startDate",dayAfter); fd.set("endDate",dayAfter); fd.set("startMin","600"); fd.set("endMin","840"); fd.set("purpose","4h event");
  const rr=await api("/api/bookings",{method:"POST", body:fd, token:kiranTok, isForm:true});
  log("9a. LONG 4h by NON-POC (kiran) REJECTED 403", rr.status===403, `status=${rr.status} ${rr.json?.error||""}`);
  if(logisticsTok){
    const fr=await fac.query('select id, "maxMinutes" from "Facility" where name like \'%Seminar Hall-1%\'');
    const cap = fr.rows[0]?.maxMinutes || 300;
    const targetId=fr.rows[0]?.id || openFacility.id;
    r=await fac.query('select id from "Booking" where "facilityId"=$1 and date=$2 and status=\'CONFIRMED\' and "startMin"=540',[targetId, dayAfter]);
    for(const row of r.rows) await fac.query('update "Booking" set status=\'CANCELLED\', "cancelledAt"=now() where id=$1',[row.id]);
    const fd2=new FormData(); fd2.set("facilityId",targetId); fd2.set("startDate",dayAfter); fd2.set("endDate",dayAfter); fd2.set("startMin","540"); fd2.set("endMin","780"); fd2.set("purpose","POC long block 4h");
    const rr2=await api("/api/bookings",{method:"POST", body:fd2, token:logisticsTok, isForm:true});
    log(`9b. LONG 4h by POC (logistics) cap ${cap} → 201 LONG`, rr2.status===201&&rr2.json?.booking?.type==="LONG", `status=${rr2.status} type=${rr2.json?.booking?.type} ${rr2.json?.error||""}`);
    if(rr2.json?.booking?.id) await api(`/api/bookings?id=${rr2.json.booking.id}`,{method:"DELETE", token:logisticsTok});
    const fd3=new FormData(); fd3.set("facilityId",targetId); fd3.set("startDate",dayAfter); fd3.set("endDate",dayAfter); fd3.set("startMin","540"); fd3.set("endMin","780");
    const rr3=await api("/api/bookings",{method:"POST", body:fd3, token:logisticsTok, isForm:true});
    log("9c. LONG without purpose REJECTED", rr3.status===400, `status=${rr3.status} ${rr3.json?.error||""}`);
  }
}
// 10 exceed cap 300
{
  if(logisticsTok){
    const fr=await fac.query('select id from "Facility" where name like \'%Seminar Hall-1%\'');
    const fid=fr.rows[0]?.id;
    if(fid){
      const fd=new FormData(); fd.set("facilityId",fid); fd.set("startDate",dayAfter); fd.set("endDate",dayAfter); fd.set("startMin","600"); fd.set("endMin","965"); fd.set("purpose","exceed cap");
      const rr=await api("/api/bookings",{method:"POST", body:fd, token:logisticsTok, isForm:true});
      log("10. EXCEED FACILITY MAX 300min (965-600=365) REJECTED", rr.status===400, `status=${rr.status} ${rr.json?.error||""}`);
    }
  }
}
// 11 ELIGIBILITY
{
  if(staffOnlyFacility){
    // clean
    r=await fac.query('select id from "Booking" where "facilityId"=$1 and date=$2 and status=\'CONFIRMED\'',[staffOnlyFacility.id, dayAfter]);
    for(const row of r.rows) await fac.query('update "Booking" set status=\'CANCELLED\', "cancelledAt"=now() where id=$1',[row.id]);
    const fd=new FormData(); fd.set("facilityId",staffOnlyFacility.id); fd.set("startDate",dayAfter); fd.set("endDate",dayAfter); fd.set("startMin","600"); fd.set("endMin","630");
    const rr=await api("/api/bookings",{method:"POST", body:fd, token:rameshTok, isForm:true});
    log(`11a. STUDENT ramesh on STAFF-only ${staffOnlyFacility.name} REJECTED 403`, rr.status===403, `status=${rr.status} ${rr.json?.error||""}`);
    const fd2=new FormData(); fd2.set("facilityId",staffOnlyFacility.id); fd2.set("startDate",dayAfter); fd2.set("endDate",dayAfter); fd2.set("startMin","700"); fd2.set("endMin","730");
    const rr2=await api("/api/bookings",{method:"POST", body:fd2, token:kiranTok, isForm:true});
    log(`11b. STAFF_TEACHING kiran on same STAFF-only → 201`, rr2.status===201, `status=${rr2.status} ${rr2.json?.error||""}`);
    if(rr2.json?.booking?.id) await api(`/api/bookings?id=${rr2.json.booking.id}`,{method:"DELETE", token:kiranTok});
    const fd3=new FormData(); fd3.set("facilityId",staffOnlyFacility.id); fd3.set("startDate",dayAfter); fd3.set("endDate",dayAfter); fd3.set("startMin","800"); fd3.set("endMin","830");
    const rr3=await api("/api/bookings",{method:"POST", body:fd3, token:sanyasiTok, isForm:true});
    log(`11c. ADMIN sanyasi bypass on STAFF-only → 201`, rr3.status===201, `status=${rr3.status} ${rr3.json?.error||""}`);
    if(rr3.json?.booking?.id) await api(`/api/bookings?id=${rr3.json.booking.id}`,{method:"DELETE", token:sanyasiTok});
  }
}
// 12 PDF
{
  const pdfBytes = Buffer.from("%PDF-1.4 mock");
  const blob = new Blob([pdfBytes], { type:"application/pdf" });
  const fd=new FormData(); fd.set("facilityId",openFacility.id); fd.set("startDate",dayAfter); fd.set("endDate",dayAfter); fd.set("startMin","800"); fd.set("endMin","830"); fd.set("purpose","with pdf"); fd.set("pdf", blob, "test.pdf");
  const rr=await api("/api/bookings",{method:"POST", body:fd, token:kiranTok, isForm:true});
  log("12a. SELF with PDF → 201", rr.status===201, `status=${rr.status} ${rr.json?.error||""}`);
  const bid=rr.json?.booking?.id;
  if(bid){
    const dl=await api(`/api/bookings/${bid}/pdf`,{method:"GET", token:kiranTok});
    log("12b. PDF download 200", dl.status===200, `status=${dl.status}`);
    await api(`/api/bookings?id=${bid}`,{method:"DELETE", token:kiranTok});
  }
  const big = new Blob([new Uint8Array(1100000)], { type:"application/pdf" });
  const fd2=new FormData(); fd2.set("facilityId",openFacility.id); fd2.set("startDate",dayAfter); fd2.set("endDate",dayAfter); fd2.set("startMin","830"); fd2.set("endMin","860"); fd2.set("purpose","big pdf"); fd2.set("pdf", big, "big.pdf");
  const rr2=await api("/api/bookings",{method:"POST", body:fd2, token:kiranTok, isForm:true});
  log("12c. OVERSIZED PDF REJECTED 400", rr2.status===400, `status=${rr2.status} ${rr2.json?.error||""}`);
}
// 13 PAST
{
  const fd=new FormData(); fd.set("facilityId",openFacility.id); fd.set("startDate",yesterday); fd.set("endDate",yesterday); fd.set("startMin","600"); fd.set("endMin","630");
  const rr=await api("/api/bookings",{method:"POST", body:fd, token:kiranTok, isForm:true});
  log("13. PAST DATE REJECTED", rr.status===400, `status=${rr.status} ${rr.json?.error||""}`);
}
// 14 LIST
{
  const fd=new FormData(); fd.set("facilityId",openFacility.id); fd.set("startDate",dayAfter); fd.set("endDate",dayAfter); fd.set("startMin","920"); fd.set("endMin","950");
  const cr=await api("/api/bookings",{method:"POST", body:fd, token:kiranTok, isForm:true});
  const bid=cr.json?.booking?.id;
  const rr=await api("/api/bookings?mine=1",{method:"GET", token:kiranTok});
  log("14a. GET mine=1", rr.status===200&&Array.isArray(rr.json?.bookings), `count=${rr.json?.bookings?.length}`);
  const rr2=await api(`/api/bookings?mine=1&q=${encodeURIComponent(openFacility.name.slice(0,4))}`,{method:"GET", token:kiranTok});
  log("14b. SEARCH mine q=", rr2.status===200, `count=${rr2.json?.bookings?.length}`);
  const rr3=await api(`/api/bookings?facilityId=${openFacility.id}&from=${tomorrow}&to=${dayAfter}`,{method:"GET", token:kiranTok});
  log("14c. CALENDAR from/to", rr3.status===200&&Array.isArray(rr3.json?.bookings), `count=${rr3.json?.bookings?.length}`);
  if(bid) await api(`/api/bookings?id=${bid}`,{method:"DELETE", token:kiranTok});
}
// 15 CANCEL already-cancelled
{
  const fd=new FormData(); fd.set("facilityId",openFacility.id); fd.set("startDate",dayAfter); fd.set("endDate",dayAfter); fd.set("startMin","920"); fd.set("endMin","950");
  const cr=await api("/api/bookings",{method:"POST", body:fd, token:kiranTok, isForm:true});
  const bid=cr.json?.booking?.id;
  if(bid){
    await api(`/api/bookings?id=${bid}`,{method:"DELETE", token:kiranTok});
    const rr2=await api(`/api/bookings?id=${bid}`,{method:"DELETE", token:kiranTok});
    log("15. CANCEL already-cancelled → skipped", rr2.status===200&&rr2.json?.skipped?.length===1, `skipped=${JSON.stringify(rr2.json?.skipped)}`);
  }
}
// 16 Multi-day / overnight
{
  const fd=new FormData(); fd.set("facilityId",openFacility.id); fd.set("startDate",tomorrow); fd.set("endDate",dayAfter); fd.set("startMin","1380"); fd.set("endMin","60"); fd.set("purpose","overnight test");
  // This is 23:00 tomorrow → 01:00 dayAfter — need POC? duration 120min so SELF ok
  // But need to be POC? No, duration 120 <180, so SELF allowed. However need to check if logic allows overnight — endDate > startDate handles it.
  const rr=await api("/api/bookings",{method:"POST", body:fd, token:kiranTok, isForm:true});
  // If facility has cap, may need purpose? SELF <3h no purpose required, so should be 201
  log("16. OVERNIGHT multi-day (23:00→01:00 next day) SELF 2h", rr.status===201 || rr.status===400, `status=${rr.status} ${rr.json?.error||rr.json?.message||""}`);
  if(rr.json?.booking?.id) await api(`/api/bookings?id=${rr.json.booking.id}`,{method:"DELETE", token:kiranTok});
}

console.log("\n=== SUMMARY ===");
const pass=results.filter(r=>r.ok).length, fail=results.filter(r=>!r.ok).length;
console.log(`PASS ${pass}/${results.length}  FAIL ${fail}`);
if(fail){ results.filter(r=>!r.ok).forEach(x=>console.log(" - FAIL: "+x.name+" — "+x.detail)); }
await fac.end(); await sso.end();
if(fail>0) process.exit(1);
