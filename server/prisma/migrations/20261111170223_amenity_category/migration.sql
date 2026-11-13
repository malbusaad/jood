-- CreateEnum
CREATE TYPE "AmenityCategory" AS ENUM ('FACILITY', 'SERVICE');

-- AlterTable
ALTER TABLE "amenities" ADD COLUMN     "category" "AmenityCategory" NOT NULL DEFAULT 'FACILITY';

-- The internet is a service, not a place.
UPDATE "amenities" SET "category" = 'SERVICE' WHERE "slug" = 'wifi';
