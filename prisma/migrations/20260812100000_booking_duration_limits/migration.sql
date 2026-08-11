-- Configurable maximum booking durations.
-- Building / Facility caps (minutes), and per-facility per-primary-role caps.
ALTER TABLE "Building" ADD COLUMN "maxMinutes" INTEGER;
ALTER TABLE "Facility" ADD COLUMN "maxMinutes" INTEGER;

CREATE TABLE "FacilityRoleLimit" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "maxMinutes" INTEGER NOT NULL,

    CONSTRAINT "FacilityRoleLimit_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "FacilityRoleLimit" ADD CONSTRAINT "FacilityRoleLimit_facilityId_fkey"
    FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "FacilityRoleLimit_facilityId_role_key" ON "FacilityRoleLimit"("facilityId", "role");
CREATE INDEX "FacilityRoleLimit_facilityId_idx" ON "FacilityRoleLimit"("facilityId");
