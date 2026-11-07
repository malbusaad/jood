-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'FIXED');

-- CreateEnum
CREATE TYPE "DiscountScope" AS ENUM ('ALL', 'FULL_ONLY');

-- CreateEnum
CREATE TYPE "RedemptionStatus" AS ENUM ('ACTIVE', 'RELEASED');

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "discount_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "discount_code" VARCHAR(30);

-- CreateTable
CREATE TABLE "discount_codes" (
    "id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "label" VARCHAR(120),
    "type" "DiscountType" NOT NULL,
    "value" DECIMAL(10,2) NOT NULL,
    "start_date" DATE,
    "end_date" DATE,
    "max_uses" INTEGER,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "one_per_guest" BOOLEAN NOT NULL DEFAULT false,
    "days_of_week" INTEGER[],
    "include_special_days" BOOLEAN NOT NULL DEFAULT true,
    "scope" "DiscountScope" NOT NULL DEFAULT 'ALL',
    "min_amount" DECIMAL(10,2),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discount_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount_redemptions" (
    "id" UUID NOT NULL,
    "code_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "guest_id" UUID NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "one_per_guest" BOOLEAN NOT NULL,
    "status" "RedemptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMP(3),

    CONSTRAINT "discount_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "discount_codes_code_key" ON "discount_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "discount_redemptions_booking_id_key" ON "discount_redemptions"("booking_id");

-- CreateIndex
CREATE INDEX "discount_redemptions_code_id_idx" ON "discount_redemptions"("code_id");

-- AddForeignKey
ALTER TABLE "discount_redemptions" ADD CONSTRAINT "discount_redemptions_code_id_fkey" FOREIGN KEY ("code_id") REFERENCES "discount_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_redemptions" ADD CONSTRAINT "discount_redemptions_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_redemptions" ADD CONSTRAINT "discount_redemptions_guest_id_fkey" FOREIGN KEY ("guest_id") REFERENCES "guests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Integrity rules for discount codes (enforced by the database, not only the app) ───
ALTER TABLE "discount_codes"
  ADD CONSTRAINT "discount_codes_value_positive" CHECK ("value" > 0),
  ADD CONSTRAINT "discount_codes_percent_max" CHECK ("type" <> 'PERCENT' OR "value" <= 100),
  ADD CONSTRAINT "discount_codes_used_nonneg" CHECK ("used_count" >= 0),
  ADD CONSTRAINT "discount_codes_used_within_max" CHECK ("max_uses" IS NULL OR "used_count" <= "max_uses"),
  ADD CONSTRAINT "discount_codes_max_positive" CHECK ("max_uses" IS NULL OR "max_uses" >= 1),
  ADD CONSTRAINT "discount_codes_dates_order" CHECK ("start_date" IS NULL OR "end_date" IS NULL OR "end_date" >= "start_date"),
  ADD CONSTRAINT "discount_codes_code_format" CHECK ("code" ~ '^[A-Z0-9_-]{3,30}$');

ALTER TABLE "discount_redemptions"
  ADD CONSTRAINT "discount_redemptions_amount_nonneg" CHECK ("amount" >= 0);

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_discount_nonneg" CHECK ("discount_amount" >= 0);

-- A guest can hold only one active use of a "once per guest" code.
CREATE UNIQUE INDEX "discount_redemptions_once_per_guest"
  ON "discount_redemptions" ("code_id", "guest_id")
  WHERE "status" = 'ACTIVE' AND "one_per_guest";

-- When a booking leaves the active statuses (cancelled, rejected, expired), its code use is released
-- and the code's counter goes back down — whichever code path changed the status.
CREATE OR REPLACE FUNCTION "booking_release_discount"() RETURNS trigger AS $$
DECLARE r RECORD;
BEGIN
  IF NEW."status" IN ('CANCELLED', 'REJECTED', 'EXPIRED')
     AND OLD."status" NOT IN ('CANCELLED', 'REJECTED', 'EXPIRED') THEN
    FOR r IN
      UPDATE "discount_redemptions" SET "status" = 'RELEASED', "released_at" = now()
      WHERE "booking_id" = NEW."id" AND "status" = 'ACTIVE'
      RETURNING "code_id"
    LOOP
      UPDATE "discount_codes" SET "used_count" = "used_count" - 1 WHERE "id" = r."code_id";
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "bookings_release_discount"
  AFTER UPDATE OF "status" ON "bookings"
  FOR EACH ROW EXECUTE FUNCTION "booking_release_discount"();
