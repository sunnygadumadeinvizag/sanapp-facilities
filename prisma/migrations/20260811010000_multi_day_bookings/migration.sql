-- Multi-day / overnight bookings: add the END day (IST).
-- Existing bookings are all single-day, so backfill endDate = date.
ALTER TABLE "Booking" ADD COLUMN "endDate" TEXT NOT NULL DEFAULT '';

UPDATE "Booking" SET "endDate" = "date" WHERE "endDate" = '';
