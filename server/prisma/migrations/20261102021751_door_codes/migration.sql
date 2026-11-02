-- CreateEnum
CREATE TYPE "DoorCodeStatus" AS ENUM ('ACTIVE', 'DELETED', 'FAILED');

-- CreateTable
CREATE TABLE "door_codes" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "provider" VARCHAR(20) NOT NULL DEFAULT 'TTLOCK',
    "lock_id" VARCHAR(40) NOT NULL,
    "external_id" VARCHAR(40),
    "code_encrypted" TEXT,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "status" "DoorCodeStatus" NOT NULL,
    "error" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "door_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "door_codes_booking_id_status_idx" ON "door_codes"("booking_id", "status");

-- AddForeignKey
ALTER TABLE "door_codes" ADD CONSTRAINT "door_codes_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
