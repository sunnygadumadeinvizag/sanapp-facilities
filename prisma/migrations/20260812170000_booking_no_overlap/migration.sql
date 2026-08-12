-- Hard database-level guarantee against double booking: no two CONFIRMED
-- bookings may overlap for the same facility.
--
-- Complements the application-level conflict check in /api/bookings, which
-- now runs inside a facility-row lock (SELECT ... FOR UPDATE) so concurrent
-- racing requests serialise. This constraint is the final backstop: even if a
-- write somehow bypasses the app check, PostgreSQL rejects the overlap.
--
-- The generated tsrange column turns the (date, endDate, startMin, endMin)
-- slot into a real time range with half-open '[)' semantics — the same
-- semantics the app uses (a slot ending exactly when another starts does NOT
-- conflict, e.g. 10:00-11:00 next to 11:00-12:00).

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Booking"
  ADD COLUMN "slotRange" tsrange
  GENERATED ALWAYS AS (
    tsrange(
      date::timestamp + make_interval(mins => "startMin"),
      COALESCE(NULLIF("endDate", ''), date)::timestamp + make_interval(mins => "endMin"),
      '[)'
    )
  ) STORED;

ALTER TABLE "Booking"
  ADD CONSTRAINT "booking_no_overlap"
  EXCLUDE USING gist (
    "facilityId" WITH =,
    "slotRange" WITH &&
  )
  WHERE (status = 'CONFIRMED');
