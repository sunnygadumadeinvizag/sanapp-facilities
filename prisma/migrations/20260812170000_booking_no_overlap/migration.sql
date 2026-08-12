-- Hard database-level guarantee against double booking: no two CONFIRMED
-- bookings may overlap for the same facility.
--
-- Complements the application-level conflict check in /api/bookings, which
-- runs inside a facility-row lock (SELECT ... FOR UPDATE) so concurrent
-- racing requests serialise. This trigger is the final backstop: even if a
-- write bypasses the app check, PostgreSQL rejects the overlap.
--
-- Overlap uses the same half-open '[)' semantics as the app: a slot ending
-- exactly when another starts does NOT conflict (10:00-11:00 next to
-- 11:00-12:00 is fine). Slots are compared as minutes-since-epoch using
-- integer math, so multi-day and overnight slots (endDate > date) are
-- handled correctly.

CREATE OR REPLACE FUNCTION booking_no_overlap_check() RETURNS trigger AS $$
DECLARE
  n_start BIGINT;
  n_end   BIGINT;
BEGIN
  IF NEW.status <> 'CONFIRMED' THEN
    RETURN NEW;
  END IF;

  -- Slot bounds in minutes since 1970-01-01 (UTC), integer math only.
  n_start := (to_date(NEW."date", 'YYYY-MM-DD') - DATE '1970-01-01')::BIGINT * 1440 + NEW."startMin";
  n_end   := (to_date(COALESCE(NULLIF(NEW."endDate", ''), NEW."date"), 'YYYY-MM-DD') - DATE '1970-01-01')::BIGINT * 1440 + NEW."endMin";

  IF EXISTS (
    SELECT 1
    FROM "Booking" o
    WHERE o."facilityId" = NEW."facilityId"
      AND o.status = 'CONFIRMED'
      AND o.id <> COALESCE(NEW.id, '')
      AND (to_date(o."date", 'YYYY-MM-DD') - DATE '1970-01-01')::BIGINT * 1440 + o."startMin" < n_end
      AND n_start < (to_date(COALESCE(NULLIF(o."endDate", ''), o."date"), 'YYYY-MM-DD') - DATE '1970-01-01')::BIGINT * 1440 + o."endMin"
  ) THEN
    RAISE EXCEPTION 'booking_no_overlap: overlapping CONFIRMED booking for facility %', NEW."facilityId"
      USING ERRCODE = '23P01';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER booking_no_overlap_trigger
BEFORE INSERT OR UPDATE OF "date", "endDate", "startMin", "endMin", "status" ON "Booking"
FOR EACH ROW
EXECUTE FUNCTION booking_no_overlap_check();
