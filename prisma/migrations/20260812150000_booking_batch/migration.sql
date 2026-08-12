-- Submission grouping: all slots confirmed in one multi-range submission
-- share one batchId, so they can be shown as a single "booking".
-- Existing slots have no batch: backfill each with its own id (its own booking).
ALTER TABLE "Booking" ADD COLUMN "batchId" TEXT;

UPDATE "Booking" SET "batchId" = "id" WHERE "batchId" IS NULL;

CREATE INDEX "Booking_batchId_idx" ON "Booking"("batchId");
