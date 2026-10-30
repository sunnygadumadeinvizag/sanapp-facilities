-- Booking descriptions and attachments are now VISIBLE TO EVERYONE by
-- default; the booking form offers "Hide description" / "Hide attachment"
-- checkboxes to restrict a booking to the booker, its POCs and app admins.
-- Existing bookings keep the visibility they were created with.
ALTER TABLE "Booking" ALTER COLUMN "isPublicPurpose" SET DEFAULT true;
ALTER TABLE "Booking" ALTER COLUMN "isPublicAttachment" SET DEFAULT true;
