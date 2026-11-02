-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "contract_accepted_at" TIMESTAMP(3),
ADD COLUMN     "contract_sent_at" TIMESTAMP(3),
ADD COLUMN     "deposit_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "reschedule_count" INTEGER NOT NULL DEFAULT 0;
