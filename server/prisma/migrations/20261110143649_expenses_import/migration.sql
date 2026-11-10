-- AlterEnum
ALTER TYPE "BookingChannel" ADD VALUE 'IMPORTED';

-- AlterTable
ALTER TABLE "guests" ALTER COLUMN "phone" DROP NOT NULL;

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "category" VARCHAR(60) NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "notes" TEXT,
    "external_ref" VARCHAR(40),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "expenses_external_ref_key" ON "expenses"("external_ref");

-- CreateIndex
CREATE INDEX "expenses_date_idx" ON "expenses"("date");

ALTER TABLE "expenses" ADD CONSTRAINT "expenses_amount_positive" CHECK ("amount" > 0);
