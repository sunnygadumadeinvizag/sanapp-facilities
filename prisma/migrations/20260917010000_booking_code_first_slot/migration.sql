-- Booking codes become first-slot-only: the unique index on "code" was
-- blocking the shared-code model (every slot of one booking used to carry the
-- code). The code now lives on the first slot of the submission group; the
-- other slots resolve it through the shared batchId, so the unique index
-- physically stays but is only ever populated once per booking.
-- Data fix: keep the code on the EARLIEST slot of each batch (by start time).
UPDATE "Booking" b
SET code = NULL
WHERE b."batchId" IS NOT NULL
  AND b.code IS NOT NULL
  AND b.id <> (
    SELECT f.id FROM "Booking" f
    WHERE f."batchId" = b."batchId"
    ORDER BY f.date ASC, f."startMin" ASC, f."createdAt" ASC
    LIMIT 1
  );
