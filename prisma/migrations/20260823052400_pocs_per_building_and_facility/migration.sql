-- CreateTable
CREATE TABLE "BuildingPoc" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuildingPoc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacilityPoc" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fromBuilding" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacilityPoc_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BuildingPoc_buildingId_userId_key" ON "BuildingPoc"("buildingId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "FacilityPoc_facilityId_userId_key" ON "FacilityPoc"("facilityId", "userId");

-- AddForeignKey
ALTER TABLE "BuildingPoc" ADD CONSTRAINT "BuildingPoc_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuildingPoc" ADD CONSTRAINT "BuildingPoc_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityPoc" ADD CONSTRAINT "FacilityPoc_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityPoc" ADD CONSTRAINT "FacilityPoc_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
