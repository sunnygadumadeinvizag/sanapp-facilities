-- Harden the double-booking backstop: PENDING_APPROVAL requests hold their slot
-- exactly like CONFIRMED bookings, but the previous trigger only checked
-- CONFIRMED rows. Any writer that bypassed the app-level check (manual SQL,
-- future code, a path added later) could create an overlapping pending request
-- — and once two overlapping requests existed, the second approval was the only
-- thing standing between the users and a real double booking.
--
-- The trigger now enforces the same invariant the app enforces: two rows that
-- both occupy the calendar (CONFIRMED or PENDING_APPROVAL) may not overlap for
-- the same facility. Cancelling, rejecting and re-timing still work — the
-- check excludes the row's own id, and non-occupying statuses are skipped.
--
-- Overlap keeps the same half-open '[)' semantics as the app: a slot ending
-- exactly when another starts does NOT conflict. Slot bounds are compared in
-- minutes since 1970-01-01 with integer math, so multi-day and overnight slots
-- (endDate > date) are handled correctly.

CREATE OR REPLACE FUNCTION booking_no_overlap_check() RETURNS trigger AS $$
DECLARE
  n_start BIGINT;
  n_end   BIGINT;
BEGIN
  IF NEW.status <> 'CONFIRMED' AND NEW.status <> 'PENDING_APPROVAL' THEN
    RETURN NEW;
  END IF;

  -- Slot bounds in minutes since 1970-01-01 (UTC), integer math only.
  n_start := (to_date(NEW."date", 'YYYY-MM-DD') - DATE '1970-01-01')::BIGINT * 1440 + NEW."startMin";
  n_end   := (to_date(COALESCE(NULLIF(NEW."endDate", ''), NEW."date"), 'YYYY-MM-DD') - DATE '1970-01-01')::BIGINT * 1440 + NEW."endMin";

  IF EXISTS (
    SELECT 1
    FROM "Booking" o
    WHERE o."facilityId" = NEW."facilityId"
      AND o.status IN ('CONFIRMED', 'PENDING_APPROVAL')
      AND o.id <> COALESCE(NEW.id, '')
      AND (to_date(o."date", 'YYYY-MM-DD') - DATE '1970-01-01')::BIGINT * 1440 + o."startMin" < n_end
      AND n_start < (to_date(COALESCE(NULLIF(o."endDate", ''), o."date"), 'YYYY-MM-DD') - DATE '1970-01-01')::BIGINT * 1440 + o."endMin"
  ) THEN
    RAISE EXCEPTION 'booking_no_overlap: overlapping % booking for facility %', NEW.status, NEW."facilityId"
      USING ERRCODE = '23P01';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- The trigger object itself is unchanged (same name, same firing columns);
-- replacing the function is enough.
