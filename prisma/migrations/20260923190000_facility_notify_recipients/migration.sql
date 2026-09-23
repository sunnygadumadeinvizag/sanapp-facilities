-- Two more recipients for a facility's booking notifications, beyond the
-- notifier address list:
--
--   notifyBookingUser — mail the person who MADE the booking on every create /
--                       edit / cancel of one of their slots on this facility.
--   notifyForUser     — mail the person a slot was blocked FOR when a POC or
--                       app admin books on their behalf.
--
-- Both default to false, so every existing facility keeps behaving exactly as
-- before until an app admin ticks the boxes in the facility form.
ALTER TABLE "FacilityNotifyConfig"
  ADD COLUMN IF NOT EXISTS "notifyBookingUser" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "FacilityNotifyConfig"
  ADD COLUMN IF NOT EXISTS "notifyForUser" BOOLEAN NOT NULL DEFAULT false;
