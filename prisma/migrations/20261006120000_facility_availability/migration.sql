-- Facility availability and facility kind.
--
-- An app admin (or the facility's approval people) can now shorten the day a
-- facility may be booked on, take recurring days out of play, close individual
-- dates, and cap the maximum booking length. Everything here is additive with
-- defaults that keep every existing facility behaving exactly as before:
--   openMin 0 / closeMin 1440  = the whole day
--   closedWeekdays {} / closedDates {} = never closed
--   isLab false / avSupportRequired false = as today
--
-- notifyApproverOnRequest defaults to TRUE so a facility that already requires
-- an approval keeps emailing its approval people the moment a request is made.

ALTER TABLE "Facility"
  ADD COLUMN IF NOT EXISTS "openMin" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "closeMin" INTEGER NOT NULL DEFAULT 1440,
  ADD COLUMN IF NOT EXISTS "closedWeekdays" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN IF NOT EXISTS "closedDates" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "isLab" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "avSupportRequired" BOOLEAN NOT NULL DEFAULT false;

-- The bookable window must stay sane; the app validates it too, this is the
-- backstop for a direct SQL edit.
ALTER TABLE "Facility"
  DROP CONSTRAINT IF EXISTS "Facility_window_check";
ALTER TABLE "Facility"
  ADD CONSTRAINT "Facility_window_check"
  CHECK ("openMin" >= 0 AND "closeMin" <= 1440 AND "closeMin" - "openMin" >= 15);

ALTER TABLE "FacilityNotifyConfig"
  ADD COLUMN IF NOT EXISTS "notifyApproverOnRequest" BOOLEAN NOT NULL DEFAULT true;
