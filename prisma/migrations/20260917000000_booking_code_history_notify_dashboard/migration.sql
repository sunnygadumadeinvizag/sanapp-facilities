-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "code" TEXT;

-- CreateTable
CREATE TABLE "BookingEvent" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "actorName" TEXT,
    "actorUsername" TEXT,
    "changes" TEXT,
    "reason" TEXT,

    CONSTRAINT "BookingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacilityNotifyConfig" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "notifyOnSlotBooked" BOOLEAN NOT NULL DEFAULT false,
    "notifyOnAvChange" BOOLEAN NOT NULL DEFAULT false,
    "notifyEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacilityNotifyConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingNotifyState" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "lastBody" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingNotifyState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardConfig" (
    "id" TEXT NOT NULL,
    "facilityIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowedUsernames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DashboardConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookingEvent_bookingId_at_idx" ON "BookingEvent"("bookingId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "FacilityNotifyConfig_facilityId_key" ON "FacilityNotifyConfig"("facilityId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingNotifyState_bookingId_key" ON "BookingNotifyState"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_code_key" ON "Booking"("code");

-- AddForeignKey
ALTER TABLE "BookingEvent" ADD CONSTRAINT "BookingEvent_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityNotifyConfig" ADD CONSTRAINT "FacilityNotifyConfig_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingNotifyState" ADD CONSTRAINT "BookingNotifyState_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
