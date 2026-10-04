-- Two extra booking states for facilities that require an approval:
--
--   PENDING_APPROVAL — the slot has been requested and is being held while an
--                      approval person decides. It blocks overlapping requests
--                      (see the no-overlap trigger in the next migration) but
--                      nobody is told the slot is theirs yet.
--   REJECTED         — the approval person declined; the slot is released.
--
-- Kept in its own migration on purpose: PostgreSQL cannot use a new enum value
-- in the same transaction that adds it, and the next migration's trigger
-- function compares against these values.
ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'PENDING_APPROVAL';
ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'REJECTED';
