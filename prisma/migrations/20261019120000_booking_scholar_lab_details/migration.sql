-- SCHOLAR lab bookings: the admission category and the scholar's roll number.
--
-- Both columns are additive with a NULL default, so nothing that exists changes:
-- a slot booked before this migration simply has no admission category or roll
-- number recorded, and AV / general facilities never populate them.

ALTER TABLE "Booking"
  ADD COLUMN IF NOT EXISTS "admissionCategory" TEXT,
  ADD COLUMN IF NOT EXISTS "rollNumber" TEXT;
