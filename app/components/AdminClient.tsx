"use client";
import { apiPath } from "iipe-common-ui";
import { useCallback, useEffect, useState } from "react";
import { fmtSlot } from "@/lib/ist";
import { PRIMARY_ROLE_LABELS } from "@/lib/labels";

const PRIMARY_ROLES = ["STAFF_TEACHING", "STAFF_NON_TEACHING", "STUDENT", "SCHOLAR", "GUEST"];

type Building = {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  location: string | null;
  order: number;
  active: boolean;
  facilities: { id: string; name: string }[];
};

type Facility = {
  id: string;
  name: string;
  description: string | null;
  capacity: number | null;
  allowedRoles: string[];
  active: boolean;
  building: { id: string; name: string };
};

type LocalUser = {
  id: string;
  username: string;
  name: string;
  email: string | null;
  primaryRole: string | null;
  role: string;
  isApprover: boolean;
  isPoc: boolean;
};

type AdminBooking = {
  id: string;
  type: "SELF" | "ON_BEHALF" | "LONG";
  status: "CONFIRMED" | "CANCELLED";
  date: string;
  startMin: number;
  endMin: number;
  purpose: string | null;
  pdf: boolean;
  facility: { name: string; building: { name: string } };
  user: { name: string; username: string };
  forUser: { name: string; username: string } | null;
};

function msg(s: string) {
  return s.trim() ? s : undefined;
}

export function AdminClient({ isAdmin }: { isAdmin: boolean }) {
  const [tab, setTab] = useState<"buildings" | "facilities" | "users" | "bookings">("buildings");
  const [error, setError] = useState<string | null>(null);

  if (!isAdmin) {
    return (
      <div className="iipe-card">
        <h2>Administrator access required</h2>
        <p className="iipe-muted">
          Only an app administrator can manage buildings, facilities, user designations and
          bookings. Please contact the app administrator if you believe this is a mistake.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="iipe-row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {(
          [
            ["buildings", "Buildings"],
            ["facilities", "Facilities"],
            ["users", "Users & designations"],
            ["bookings", "All bookings"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            className={`iipe-btn ${tab === key ? "" : "ghost"}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <div className="iipe-alert danger">{error}</div>}

      {tab === "buildings" && <BuildingsTab onError={setError} />}
      {tab === "facilities" && <FacilitiesTab onError={setError} />}
      {tab === "users" && <UsersTab onError={setError} />}
      {tab === "bookings" && <BookingsTab onError={setError} />}
    </div>
  );
}

/* ------------------------------- Buildings ------------------------------- */

function BuildingsTab({ onError }: { onError: (s: string | null) => void }) {
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");

  async function load() {
    const res = await fetch(apiPath("/api/buildings"), { cache: "no-store" });
    const data = await res.json();
    if (res.ok) setBuildings(data.buildings);
  }
  useEffect(() => {
    void load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch(apiPath("/api/buildings"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, code: msg(code), description: msg(description), location: msg(location) }),
    });
    const data = await res.json();
    if (!res.ok) return onError(data.error ?? "Could not create building");
    setName("");
    setCode("");
    setDescription("");
    setLocation("");
    onError(null);
    await load();
  }

  async function patch(b: Building, fields: Record<string, unknown>) {
    const res = await fetch(apiPath("/api/buildings"), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: b.id, ...fields }),
    });
    const data = await res.json();
    if (!res.ok) return onError(data.error ?? "Could not update building");
    onError(null);
    await load();
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <form className="iipe-card" onSubmit={create}>
        <h3 style={{ marginTop: 0 }}>Add a building</h3>
        <div className="iipe-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          <div className="iipe-field"><label>Name *</label><input value={name} onChange={(e) => setName(e.target.value)} required /></div>
          <div className="iipe-field"><label>Code</label><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. LIB" /></div>
        </div>
        <div className="iipe-field"><label>Description</label><textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <div className="iipe-field"><label>Location</label><input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Main Campus, Block A" /></div>
        <div className="iipe-form-actions"><button className="iipe-btn" type="submit">Add building</button></div>
      </form>

      {buildings.map((b) => (
        <div key={b.id} className="iipe-card">
          <div className="iipe-row" style={{ alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
            <div style={{ minWidth: 0 }}>
              <h3 style={{ margin: 0 }}>{b.name} {b.code ? `(${b.code})` : ""}</h3>
              <div className="iipe-muted" style={{ fontSize: "0.85rem" }}>
                {b.facilities.length} facilities · {b.location ?? "no location"}
              </div>
            </div>
            <span className="iipe-spacer" />
            <button className="iipe-btn ghost" style={{ color: "var(--iipe-danger)" }} onClick={() => patch(b, { active: false })}>
              Deactivate
            </button>
          </div>
          {b.description && <p className="iipe-muted" style={{ fontSize: "0.92rem", margin: "8px 0 0" }}>{b.description}</p>}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ Facilities ------------------------------- */

function FacilitiesTab({ onError }: { onError: (s: string | null) => void }) {
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [buildingId, setBuildingId] = useState("");
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [capacity, setCapacity] = useState("");
  const [allowedRoles, setAllowedRoles] = useState<string[]>([]);

  async function loadBuildings() {
    const res = await fetch(apiPath("/api/buildings"), { cache: "no-store" });
    const data = await res.json();
    if (res.ok) {
      setBuildings(data.buildings);
      if (!buildingId && data.buildings.length > 0) setBuildingId(data.buildings[0].id);
    }
  }
  async function loadFacilities(bid: string) {
    if (!bid) return;
    const res = await fetch(apiPath(`/api/facilities?buildingId=${bid}`), { cache: "no-store" });
    const data = await res.json();
    if (res.ok) setFacilities(data.facilities);
  }
  useEffect(() => {
    void loadBuildings();
  }, []);
  useEffect(() => {
    if (buildingId) void loadFacilities(buildingId);
  }, [buildingId]);

  function toggleRole(r: string) {
    setAllowedRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch(apiPath("/api/facilities"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        buildingId,
        name,
        description: msg(description),
        capacity: capacity ? Number(capacity) : null,
        allowedRoles,
      }),
    });
    const data = await res.json();
    if (!res.ok) return onError(data.error ?? "Could not create facility");
    setName("");
    setDescription("");
    setCapacity("");
    setAllowedRoles([]);
    onError(null);
    await loadFacilities(buildingId);
  }

  async function patch(f: Facility, fields: Record<string, unknown>) {
    const res = await fetch(apiPath("/api/facilities"), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: f.id, ...fields }),
    });
    const data = await res.json();
    if (!res.ok) return onError(data.error ?? "Could not update facility");
    onError(null);
    await loadFacilities(buildingId);
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <form className="iipe-card" onSubmit={create}>
        <h3 style={{ marginTop: 0 }}>Add a facility</h3>
        <div className="iipe-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          <div className="iipe-field">
            <label>Building *</label>
            <select value={buildingId} onChange={(e) => setBuildingId(e.target.value)} required>
              {buildings.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
          <div className="iipe-field"><label>Facility name *</label><input value={name} onChange={(e) => setName(e.target.value)} required /></div>
          <div className="iipe-field"><label>Capacity</label><input type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} /></div>
        </div>
        <div className="iipe-field"><label>Description</label><textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <div className="iipe-field">
          <label>Who may book (primary roles — none selected means everyone)</label>
          <div className="iipe-row" style={{ gap: 10, flexWrap: "wrap" }}>
            {PRIMARY_ROLES.map((r) => (
              <label key={r} className="iipe-check">
                <input type="checkbox" checked={allowedRoles.includes(r)} onChange={() => toggleRole(r)} />{" "}
                {PRIMARY_ROLE_LABELS[r] ?? r}
              </label>
            ))}
          </div>
        </div>
        <div className="iipe-form-actions"><button className="iipe-btn" type="submit">Add facility</button></div>
      </form>

      {facilities.map((f) => (
        <div key={f.id} className="iipe-card">
          <div className="iipe-row" style={{ alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <h3 style={{ margin: 0 }}>{f.name}</h3>
              <div className="iipe-muted" style={{ fontSize: "0.85rem" }}>
                {f.building.name}{f.capacity ? ` · capacity ${f.capacity}` : ""}
              </div>
              {f.description && <p className="iipe-muted" style={{ fontSize: "0.9rem", margin: "6px 0 0" }}>{f.description}</p>}
              <div className="iipe-row" style={{ gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                {f.allowedRoles.length === 0 ? (
                  <span className="iipe-badge">Open to all</span>
                ) : (
                  f.allowedRoles.map((r) => (
                    <span key={r} className="iipe-badge">{PRIMARY_ROLE_LABELS[r] ?? r}</span>
                  ))
                )}
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, flexDirection: "column" }}>
              <button className="iipe-btn ghost" style={{ color: "var(--iipe-danger)" }} onClick={() => patch(f, { active: false })}>
                Deactivate
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* --------------------------------- Users --------------------------------- */

function UsersTab({ onError }: { onError: (s: string | null) => void }) {
  const [users, setUsers] = useState<LocalUser[]>([]);

  async function load() {
    const res = await fetch(apiPath("/api/users"), { cache: "no-store" });
    const data = await res.json();
    if (res.ok) setUsers(data.users);
  }
  useEffect(() => {
    void load();
  }, []);

  async function patch(u: LocalUser, fields: Record<string, unknown>) {
    const res = await fetch(apiPath("/api/users"), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: u.id, ...fields }),
    });
    const data = await res.json();
    if (!res.ok) return onError(data.error ?? "Could not update user");
    onError(null);
    await load();
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {users.length === 0 && <p className="iipe-muted">No users have signed in yet.</p>}
      {users.map((u) => (
        <div key={u.id} className="iipe-card" style={{ padding: 12 }}>
          <div className="iipe-row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{u.name} <span className="iipe-muted">@{u.username}</span></div>
              <div className="iipe-muted" style={{ fontSize: "0.85rem" }}>
                {PRIMARY_ROLE_LABELS[u.primaryRole ?? ""] ?? u.primaryRole ?? "No primary role"} · {u.email ?? ""}
              </div>
            </div>
            <select
              value={u.role}
              onChange={(e) => patch(u, { role: e.target.value })}
              style={{ padding: "4px 6px", borderRadius: 6, border: "1px solid var(--iipe-border)" }}
            >
              <option value="USER">User</option>
              <option value="ADMIN">App Admin</option>
            </select>
            <label className="iipe-check">
              <input type="checkbox" checked={u.isApprover} onChange={(e) => patch(u, { isApprover: e.target.checked })} /> Approver
            </label>
            <label className="iipe-check">
              <input type="checkbox" checked={u.isPoc} onChange={(e) => patch(u, { isPoc: e.target.checked })} /> POC
            </label>
          </div>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------- Bookings -------------------------------- */

function BookingsTab({ onError }: { onError: (s: string | null) => void }) {
  const [bookings, setBookings] = useState<AdminBooking[]>([]);

  const load = useCallback(async () => {
    const res = await fetch(apiPath("/api/bookings?all=1"), { cache: "no-store" });
    const data = await res.json();
    if (res.ok) setBookings(data.bookings);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function cancel(id: string) {
    if (!confirm("Cancel this booking?")) return;
    const res = await fetch(apiPath(`/api/bookings?id=${id}`), { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) return onError(data.error ?? "Could not cancel");
    onError(null);
    await load();
  }

  if (bookings.length === 0) return <p className="iipe-muted">No bookings yet.</p>;

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {bookings.map((b) => (
        <div key={b.id} className="iipe-card" style={{ padding: 12 }}>
          <div className="iipe-row" style={{ gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 600 }}>
                {b.facility.building.name} — {b.facility.name}
              </div>
              <div className="iipe-muted" style={{ fontSize: "0.9rem" }}>
                {b.date} · {fmtSlot(b.startMin, b.endMin)} · {b.user.name} (@{b.user.username})
                {b.forUser ? ` → for ${b.forUser.name}` : ""}
              </div>
              {b.purpose && <div style={{ fontSize: "0.9rem", marginTop: 2 }}>{b.purpose}</div>}
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexDirection: "column" }}>
              <span className="iipe-badge">
                {b.type === "SELF" ? "Self" : b.type === "ON_BEHALF" ? "Blocked" : "Long"}
                {b.status === "CANCELLED" ? " · Cancelled" : ""}
              </span>
              {b.status === "CONFIRMED" && (
                <button className="iipe-btn ghost" style={{ color: "var(--iipe-danger)" }} onClick={() => cancel(b.id)}>
                  Cancel
                </button>
              )}
              {b.pdf && (
                <a className="iipe-btn ghost" href={apiPath(`/api/bookings/${b.id}/pdf`)} target="_blank" rel="noreferrer">
                  PDF
                </a>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
