-- Per-IST-day counter for booking references. The reference carries the day
-- the booking was made, so the number restarts each day.
CREATE TABLE IF NOT EXISTS "BookingCodeCounter" (
  "day" TEXT NOT NULL,
  "n" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "BookingCodeCounter_pkey" PRIMARY KEY ("day")
);
