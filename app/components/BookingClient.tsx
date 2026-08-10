"use client";
import { apiPath } from "iipe-common-ui";
import { useMemo, useState } from "react";
import {
  PDF_MAX_BYTES,
  SLOT_MAX_MINUTES,
  SLOT_MIN_MINUTES,
  fmtMin,
  fmtSlot,
} from "@/lib/ist";

export type SlotItem = {
  id: string;
  startMin: number;
  endMin: number;
  bookerName: string;
  forName: string | null;
};

export type BookingMe = {
  name: string;
  primaryRole: string;
  role: string;
  isApprover: boolean;
  isPoc: boolean;
};

// Booking window: 06:00 – 24:00 IST (start times in 15-minute steps).
const OPEN_MIN = 6 * 60;
const LAST_START = 24 * 60 - SLOT_MIN_MINUTES; // 23:45

const NORMAL_DURATIONS = [15, 30, 45, 60, 90, 120, 150, 180];
const LONG_DURATIONS = [
  210, 240, 270, 300, 360, 420, 480, 540, 600, 660, 720, 840, 960, 1080, 1200, 1320, 1440,
];

function clientIstNowMin(): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    return h * 60 + m;
  } catch {
    return 0;
  }
}

export function BookingClient({
  facility,
  buildingName,
  today,
  todaySlots,
  me,
  eligible,
  nowMin = 0,
}: {
  facility: { id: string; name: string };
  buildingName: string;
  today: string;
  todaySlots: SlotItem[];
  me: BookingMe;
  eligible: boolean;
  nowMin?: number;
}) {
  const canApprover = me.isApprover || me.role === "ADMIN";
  const canPoc = me.isPoc || me.role === "ADMIN";

  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today);
  const [slots, setSlots] = useState<SlotItem[]>(todaySlots);
  const [startMin, setStartMin] = useState(OPEN_MIN);
  const [duration, setDuration] = useState(60);
  const [longMode, setLongMode] = useState(false);
  const [forOther, setForOther] = useState(false);
  const [forQuery, setForQuery] = useState("");
  const [forResults, setForResults] = useState<{ id: string; username: string; name: string }[]>([]);
  const [forUserId, setForUserId] = useState("");
  const [purpose, setPurpose] = useState("");
  const [pdfName, setPdfName] = useState("");
  const [pdf, setPdf] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const effectiveDurations = longMode ? LONG_DURATIONS : NORMAL_DURATIONS;

  const startOptions = useMemo(() => {
    const opts: number[] = [];
    for (let m = OPEN_MIN; m <= LAST_START; m += SLOT_MIN_MINUTES) opts.push(m);
    return opts;
  }, []);

  const nowM = date === today ? (nowMin > 0 ? nowMin : clientIstNowMin()) : 0;

  function overlap(m: number, d: number): boolean {
    return slots.some((s) => m < s.endMin && m + d > s.startMin);
  }

  function validStart(m: number, d: number): boolean {
    if (m < nowM) return false;
    if (m + d > 24 * 60) return false;
    return !overlap(m, d);
  }

  async function refreshSlots(forDate: string) {
    try {
      const res = await fetch(
        apiPath(`/api/bookings?facilityId=${facility.id}&date=${forDate}`),
        { cache: "no-store" }
      );
      if (res.ok) {
        const data = await res.json();
        setSlots(data.bookings);
      }
    } catch {
      /* keep current slots */
    }
  }

  async function searchUsers(q: string) {
    if (!q.trim()) {
      setForResults([]);
      return;
    }
    try {
      const res = await fetch(apiPath(`/api/users?kind=sso&q=${encodeURIComponent(q)}`));
      if (res.ok) {
        const data = await res.json();
        setForResults(data.users ?? []);
      }
    } catch {
      setForResults([]);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);

    const endMin = startMin + duration;
    const form = new FormData();
    form.set("facilityId", facility.id);
    form.set("date", date);
    form.set("startMin", String(startMin));
    form.set("endMin", String(endMin));
    if (purpose.trim()) form.set("purpose", purpose.trim());
    if (forOther && forUserId) form.set("forUserId", forUserId);
    if (pdf) form.set("pdf", pdf, pdf.name);

    try {
      const res = await fetch(apiPath("/api/bookings"), { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not create the booking");
      setSuccess(`${fmtSlot(startMin, endMin)} confirmed.`);
      setPurpose("");
      setPdf(null);
      setPdfName("");
      setForUserId("");
      setForQuery("");
      setForResults([]);
      await refreshSlots(date);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the booking");
    } finally {
      setBusy(false);
    }
  }

  function pickFile(f: File | null) {
    if (!f) {
      setPdf(null);
      setPdfName("");
      return;
    }
    if (!f.name.toLowerCase().endsWith(".pdf")) {
      setError("Attachment must be a PDF file");
      return;
    }
    if (f.size > PDF_MAX_BYTES) {
      setError("PDF attachment must be 1 MB or smaller");
      return;
    }
    setError(null);
    setPdf(f);
    setPdfName(f.name);
  }

  const needPurpose = forOther || longMode;

  return (
    <div style={{ marginTop: 12 }}>
      {/* Day's schedule */}
      <div className="iipe-row" style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <label className="iipe-muted" style={{ fontSize: "0.85rem" }}>
          Day:
        </label>
        <input
          type="date"
          value={date}
          min={today}
          onChange={async (e) => {
            const d = e.target.value;
            setDate(d);
            setStartMin(OPEN_MIN);
            if (d !== today) await refreshSlots(d);
          }}
          style={{ padding: "4px 8px", border: "1px solid var(--iipe-border)", borderRadius: 6 }}
        />
        <span className="iipe-muted" style={{ fontSize: "0.85rem" }}>
          {slots.length} booked
        </span>
      </div>

      {slots.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {slots.map((s) => (
            <span
              key={s.id}
              className="iipe-badge"
              style={{ background: "var(--iipe-danger-light)", color: "var(--iipe-text)" }}
              title={s.forName ? `Blocked for ${s.forName}` : undefined}
            >
              {fmtSlot(s.startMin, s.endMin)} · {s.forName ?? s.bookerName}
            </span>
          ))}
        </div>
      )}

      {!eligible && (
        <div className="iipe-alert" style={{ marginTop: 10 }}>
          This facility is restricted to specific primary roles. Your role (
          {me.primaryRole || "not set"}) is not in the allowed list.
          {canApprover ? " You can still block a slot for an eligible user using approval access." : ""}
        </div>
      )}

      {open && (
        <form onSubmit={submit} style={{ marginTop: 12, borderTop: "1px solid var(--iipe-border)", paddingTop: 12 }}>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            <div className="iipe-field">
              <label>Start time (IST)</label>
              <select
                value={startMin}
                onChange={(e) => setStartMin(Number(e.target.value))}
                style={{ width: "100%" }}
              >
                {startOptions.map((m) => (
                  <option key={m} value={m} disabled={!validStart(m, duration)}>
                    {fmtMin(m)}
                  </option>
                ))}
              </select>
            </div>
            <div className="iipe-field">
              <label>Duration</label>
              <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} style={{ width: "100%" }}>
                {effectiveDurations.map((d) => (
                  <option key={d} value={d} disabled={startMin + d > 24 * 60}>
                    {d < 60 ? `${d} min` : d % 60 === 0 ? `${d / 60} hour${d / 60 > 1 ? "s" : ""}` : `${Math.floor(d / 60)}h ${d % 60}m`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="iipe-muted" style={{ fontSize: "0.85rem", marginTop: 6 }}>
            {longMode
              ? "Long booking (POC) — more than 3 hours, booked on your own name."
              : forOther
                ? "Blocking for another user (approval access) — 15 min to 3 hours."
                : `Self booking — ${SLOT_MIN_MINUTES} min to ${SLOT_MAX_MINUTES / 60} hours.`}
          </div>

          {(canApprover || canPoc) && (
            <div className="iipe-row" style={{ gap: 16, marginTop: 8, flexWrap: "wrap" }}>
              {canApprover && (
                <label className="iipe-check">
                  <input
                    type="checkbox"
                    checked={forOther}
                    onChange={(e) => {
                      setForOther(e.target.checked);
                      if (e.target.checked) setLongMode(false);
                    }}
                  />{" "}
                  Block for another user
                </label>
              )}
              {canPoc && (
                <label className="iipe-check">
                  <input
                    type="checkbox"
                    checked={longMode}
                    onChange={(e) => {
                      setLongMode(e.target.checked);
                      if (e.target.checked) setForOther(false);
                    }}
                  />{" "}
                  Long booking (&gt; 3 hours)
                </label>
              )}
            </div>
          )}

          {forOther && (
            <div className="iipe-field" style={{ marginTop: 8 }}>
              <label>Book for (search by name or username)</label>
              <input
                type="text"
                value={forQuery}
                placeholder="e.g. sanyasi or Sanyasi Naidu"
                onChange={(e) => {
                  setForQuery(e.target.value);
                  setForUserId("");
                  void searchUsers(e.target.value);
                }}
              />
              {forResults.length > 0 && (
                <div className="iipe-card" style={{ marginTop: 6, padding: 8 }}>
                  {forResults.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      className="iipe-btn ghost"
                      style={{ display: "block", width: "100%", textAlign: "left", marginBottom: 4 }}
                      onClick={() => {
                        setForUserId(u.id);
                        setForQuery(`${u.name} (@${u.username})`);
                        setForResults([]);
                      }}
                    >
                      {u.name} (@{u.username})
                    </button>
                  ))}
                </div>
              )}
              {forQuery && !forUserId && forResults.length === 0 && (
                <div className="iipe-muted" style={{ fontSize: "0.85rem" }}>No matching users.</div>
              )}
            </div>
          )}

          <div className="iipe-field" style={{ marginTop: 8 }}>
            <label htmlFor={`purpose-${facility.id}`}>
              Description {needPurpose ? "(required)" : "(optional)"}
            </label>
            <textarea
              id={`purpose-${facility.id}`}
              value={purpose}
              rows={2}
              placeholder={needPurpose ? "Describe the purpose of this booking" : "Optional — e.g. weekly staff meeting"}
              onChange={(e) => setPurpose(e.target.value)}
            />
          </div>

          <div className="iipe-field" style={{ marginTop: 8 }}>
            <label>Attachment (PDF, max 1 MB, optional)</label>
            <input type="file" accept="application/pdf,.pdf" onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
            {pdfName && (
              <div className="iipe-muted" style={{ fontSize: "0.85rem" }}>📎 {pdfName}</div>
            )}
          </div>

          {error && <div className="iipe-alert danger" style={{ marginTop: 8 }}>{error}</div>}
          {success && <div className="iipe-alert" style={{ marginTop: 8 }}>{success}</div>}

          <div className="iipe-form-actions" style={{ marginTop: 10 }}>
            <button
              type="submit"
              className="iipe-btn"
              disabled={busy || (forOther && !forUserId) || (needPurpose && !purpose.trim()) || !validStart(startMin, duration)}
            >
              {busy ? "Booking…" : longMode ? "Book long slot" : forOther ? "Block slot" : "Book slot"}
            </button>
            <button type="button" className="iipe-btn ghost" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </form>
      )}

      {!open && (
        <div className="iipe-form-actions" style={{ marginTop: 10 }}>
          <button className="iipe-btn" onClick={() => setOpen(true)} disabled={!eligible && !canApprover}>
            {longMode ? "Book long slot" : "Book a slot"}
          </button>
          <span className="iipe-muted" style={{ fontSize: "0.85rem" }}>
            {buildingName} · {facility.name}
          </span>
        </div>
      )}
    </div>
  );
}
