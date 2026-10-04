-- Facilities can now require an approval before a requested slot becomes a
-- confirmed booking, and the bookings dashboard can be shared facility by
-- facility with individual people.
--
-- Everything here is additive with defaults that keep every existing facility
-- behaving exactly as before: requiresApproval defaults to false, so no
-- booking changes state until an app admin ticks the box on a facility.

-- 1. Per-facility switch -----------------------------------------------------
ALTER TABLE "Facility"
  ADD COLUMN IF NOT EXISTS "requiresApproval" BOOLEAN NOT NULL DEFAULT false;

-- 2. Approval bookkeeping on the booking itself ------------------------------
--    approvalRequestedAt — when the slot started waiting for a decision
--    decidedAt / decidedById / decisionNote — who decided it and why
--    All NULL for facilities that never required an approval, and for slots
--    booked directly by a POC / app ADMIN.
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "approvalRequestedAt" TIMESTAMP(3);
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "decidedAt" TIMESTAMP(3);
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "decidedById" TEXT;
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "decisionNote" TEXT;

ALTER TABLE "Booking" ADD CONSTRAINT "Booking_decidedById_fkey"
  FOREIGN KEY ("decidedById") REFERENCES "AppUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Approval people per facility -------------------------------------------
CREATE TABLE "FacilityApprover" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacilityApprover_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FacilityApprover_facilityId_userId_key"
  ON "FacilityApprover"("facilityId", "userId");

ALTER TABLE "FacilityApprover" ADD CONSTRAINT "FacilityApprover_facilityId_fkey"
  FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FacilityApprover" ADD CONSTRAINT "FacilityApprover_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Per-facility dashboard viewers -----------------------------------------
CREATE TABLE "FacilityDashboardViewer" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacilityDashboardViewer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FacilityDashboardViewer_facilityId_userId_key"
  ON "FacilityDashboardViewer"("facilityId", "userId");

ALTER TABLE "FacilityDashboardViewer" ADD CONSTRAINT "FacilityDashboardViewer_facilityId_fkey"
  FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FacilityDashboardViewer" ADD CONSTRAINT "FacilityDashboardViewer_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. The no-overlap guarantee now covers slots that are awaiting approval ----
--    A pending request holds its slot, so two overlapping requests cannot both
--    be waiting (and a pending request blocks a direct confirmation until it
--    is decided). Cancelled and declined slots are free again.
--
--    The trigger itself already exists (booking_no_overlap_trigger, created in
--    20260812170000_booking_no_overlap) and fires on INSERT / UPDATE OF
--    date, endDate, startMin, endMin, status, so replacing the function body is
--    enough.
CREATE OR REPLACE FUNCTION booking_no_overlap_check() RETURNS trigger AS $$
DECLARE
  n_start BIGINT;
  n_end   BIGINT;
BEGIN
  -- Only slots that actually occupy the calendar are checked: confirmed
  -- bookings and requests still waiting for a decision.
  IF NEW.status NOT IN ('CONFIRMED', 'PENDING_APPROVAL') THEN
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
    RAISE EXCEPTION 'booking_no_overlap: overlapping booking for facility %', NEW."facilityId"
      USING ERRCODE = '23P01';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
