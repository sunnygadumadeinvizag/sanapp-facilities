"use client";
import { apiPath } from "iipe-common-ui";
import { useEffect, useState } from "react";
import { fmtSlot } from "@/lib/ist";

export type MyBooking = {
  id: string;
  type: "SELF" | "ON_BEHALF" | "LONG";
  status: "CONFIRMED" | "CANCELLED";
  date: string;
  startMin: number;
  endMin: number;
  purpose: string | null;
  pdf: boolean;
  facility: { id: string; name: string; building: { id: string; name: string } };
  forUser: { id: string; username: string; name: string } | null;
};

export function MyBookingsClient({ today }: { today: string }) {
  const [bookings, setBookings] = useState<MyBooking[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch(apiPath("/api/bookings?mine=1"), { cache: "no-store" });
      if (!res.ok) throw new Error("Could not load bookings");
      const data = await res.json();
      setBookings(data.bookings);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load bookings");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function cancel(id: string) {
    if (!confirm("Cancel this booking?")) return;
    try {
      const res = await fetch(apiPath(`/api/bookings?id=${id}`), { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not cancel");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel");
    }
  }

  if (error) return <div className="iipe-alert danger">{error}</div>;
  if (!bookings) return <p className="iipe-muted">Loading your bookings…</p>;

  const upcoming = bookings.filter((b) => b.status === "CONFIRMED" && b.date >= today);
  const past = bookings.filter((b) => b.status === "CANCELLED" || b.date < today);

  function renderList(list: MyBooking[], emptyText: string) {
    if (list.length === 0) return <p className="iipe-muted">{emptyText}</p>;
    return (
      <div style={{ display: "grid", gap: 10 }}>
        {list.map((b) => (
          <div key={b.id} className="iipe-card" style={{ padding: 12 }}>
            <div className="iipe-row" style={{ alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>
                  {b.facility.building.name} — {b.facility.name}
                </div>
                <div className="iipe-muted" style={{ fontSize: "0.9rem" }}>
                  {b.date} · {fmtSlot(b.startMin, b.endMin)}
                </div>
                {b.forUser && (
                  <div className="iipe-muted" style={{ fontSize: "0.85rem" }}>
                    Blocked for {b.forUser.name} (@{b.forUser.username})
                  </div>
                )}
                {b.purpose && <div style={{ fontSize: "0.9rem", marginTop: 4 }}>{b.purpose}</div>}
              </div>
              <span className="iipe-spacer" />
              <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                <span className="iipe-badge">
                  {b.type === "SELF" ? "Self" : b.type === "ON_BEHALF" ? "Blocked" : "Long"}
                </span>
                {b.status === "CANCELLED" && <span className="iipe-badge" style={{ background: "var(--iipe-danger-light)" }}>Cancelled</span>}
                <div style={{ display: "flex", gap: 6 }}>
                  {b.pdf && (
                    <a className="iipe-btn ghost" href={apiPath(`/api/bookings/${b.id}/pdf`)} target="_blank" rel="noreferrer">
                      PDF
                    </a>
                  )}
                  {b.status === "CONFIRMED" && b.date >= today && (
                    <button className="iipe-btn ghost" style={{ color: "var(--iipe-danger)" }} onClick={() => cancel(b.id)}>
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <section>
        <h2 className="iipe-page-title" style={{ fontSize: "1.1rem" }}>Upcoming</h2>
        {renderList(upcoming, "No upcoming bookings.")}
      </section>
      <section>
        <h2 className="iipe-page-title" style={{ fontSize: "1.1rem" }}>Past &amp; cancelled</h2>
        {renderList(past, "Nothing here yet.")}
      </section>
    </div>
  );
}
