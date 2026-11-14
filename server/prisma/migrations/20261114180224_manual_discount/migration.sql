-- CreateEnum
CREATE TYPE "ManualDiscountType" AS ENUM ('FIXED', 'PERCENT', 'FINAL_PRICE');

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "manual_discount_type" "ManualDiscountType",
ADD COLUMN     "manual_discount_value" DECIMAL(10,2);
