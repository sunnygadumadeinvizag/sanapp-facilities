-- Booking cancellation history: who cancelled, when, and why.
ALTER TABLE "Booking" ADD COLUMN "cancelledAt" TIMESTAMP(3);
ALTER TABLE "Booking" ADD COLUMN "cancelledById" TEXT;
ALTER TABLE "Booking" ADD COLUMN "cancelReason" TEXT;

ALTER TABLE "Booking" ADD CONSTRAINT "Booking_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "AppUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Booking_cancelledById_idx" ON "Booking"("cancelledById");
