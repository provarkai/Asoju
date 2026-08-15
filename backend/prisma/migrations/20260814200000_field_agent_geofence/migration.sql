-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "checkInAccuracy" DOUBLE PRECISION,
ADD COLUMN     "geofenceResult" TEXT,
ADD COLUMN     "geofenceDistanceMeters" DOUBLE PRECISION;
