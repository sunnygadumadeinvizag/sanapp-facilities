-- LAB facilities: the supervisor and department of a booking, and per-weekday
-- bookable hours on the facility.
--
-- Every column is additive with a NULL default, so nothing that exists changes:
-- a slot booked before this migration simply has no supervisor recorded, and a
-- facility without dayWindows keeps using its single openMin/closeMin window.

ALTER TABLE "Booking"
  ADD COLUMN IF NOT EXISTS "supervisorUsername" TEXT,
  ADD COLUMN IF NOT EXISTS "supervisorName" TEXT,
  ADD COLUMN IF NOT EXISTS "department" TEXT;

ALTER TABLE "Facility"
  ADD COLUMN IF NOT EXISTS "dayWindows" JSONB;
