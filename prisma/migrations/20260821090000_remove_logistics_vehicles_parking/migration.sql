-- Remove logistics (vehicle requests & parking requests).
-- Drop child tables first, then parents, then the enums.

DROP TABLE IF EXISTS "VehicleRequest" CASCADE;
DROP TABLE IF EXISTS "ParkingRequest" CASCADE;
DROP TABLE IF EXISTS "Vehicle" CASCADE;
DROP TABLE IF EXISTS "ParkingSlot" CASCADE;

DROP TYPE IF EXISTS "VehicleStatus";
DROP TYPE IF EXISTS "RequestStatus";
