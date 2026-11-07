-- CreateEnum
CREATE TYPE "PaymentPlan" AS ENUM ('FULL', 'DEPOSIT');

-- CreateEnum
CREATE TYPE "DepositTiming" AS ENUM ('WITH_FIRST_PAYMENT', 'BEFORE_CHECKIN');

-- CreateEnum
CREATE TYPE "PaymentPurpose" AS ENUM ('BOOKING', 'SECURITY_DEPOSIT');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('PAYMENT', 'REFUND');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_DUE';

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'CASH';

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "balance_alert_at" TIMESTAMP(3),
ADD COLUMN     "deposit_timing" "DepositTiming" NOT NULL DEFAULT 'WITH_FIRST_PAYMENT',
ADD COLUMN     "legacy_payment" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "payment_plan" "PaymentPlan" NOT NULL DEFAULT 'FULL',
ADD COLUMN     "upfront_amount" DECIMAL(10,2);

-- Existing bookings keep the rules they were made under: full amount up front, and nothing new
-- (deposit tracking, hidden door codes) applies to them.
UPDATE "bookings" SET "upfront_amount" = "total_amount", "legacy_payment" = true;
ALTER TABLE "bookings" ALTER COLUMN "upfront_amount" SET NOT NULL;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "kind" "PaymentKind" NOT NULL DEFAULT 'PAYMENT',
ADD COLUMN     "purpose" "PaymentPurpose" NOT NULL DEFAULT 'BOOKING';

-- Integrity: the up-front part is never negative nor more than the booking amount; amounts are positive.
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_upfront_range" CHECK ("upfront_amount" >= 0 AND "upfront_amount" <= "total_amount");
