-- SCHOLAR lab bookings: snapshot the details that already live in the central
-- registry (nature of admission and choice of specialization). Roll number and
-- department already exist on Booking.
ALTER TABLE "Booking"
  ADD COLUMN IF NOT EXISTS "natureOfAdmission" TEXT,
  ADD COLUMN IF NOT EXISTS "specialization" TEXT;
