-- Human-readable booking references: FACLTY-BKG-R1, FACLTY-BKG-R2, ...
--
-- A Postgres sequence (rather than MAX(code)+1 in application code) is what
-- makes this safe under concurrency: two people booking different facilities at
-- the same moment can never be handed the same reference. The app locks the
-- Facility row per booking, but that lock does not span facilities.
CREATE SEQUENCE IF NOT EXISTS booking_code_seq START WITH 1 INCREMENT BY 1;

-- Bookings created before the code column existed have code = NULL, which made
-- the UI fall back to showing a raw UUID (code ?? batchId ?? id). Give every
-- submission group a readable reference, numbered in creation order.
--
-- Only the FIRST slot of a submission group carries the code; the rest resolve
-- it through the shared batchId, so only rows that are a group anchor and have
-- no code yet are touched.
WITH ranked AS (
  SELECT
    id,
    COALESCE("batchId", id) AS grp,
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE("batchId", id)
      ORDER BY "date" ASC, "startMin" ASC, "createdAt" ASC
    ) AS rn
  FROM "Booking"
),
anchors AS (
  SELECT id FROM ranked WHERE rn = 1
),
needs AS (
  SELECT b.id, b."createdAt"
  FROM anchors a
  JOIN "Booking" b ON b.id = a.id
  WHERE b."code" IS NULL
),
ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, id ASC) AS n
  FROM needs
)
UPDATE "Booking" t
SET "code" = 'FACLTY-BKG-R' || o.n
FROM ordered o
WHERE t.id = o.id;

-- Continue the sequence after the highest number handed out above.
-- is_called = false so the very next nextval() returns this value.
SELECT setval(
  'booking_code_seq',
  COALESCE((
    SELECT MAX(REPLACE("code", 'FACLTY-BKG-R', '')::int)
    FROM "Booking"
    WHERE "code" LIKE 'FACLTY-BKG-R%'
  ), 0) + 1,
  false
);
