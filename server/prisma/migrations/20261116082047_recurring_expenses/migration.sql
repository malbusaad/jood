-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "recurring" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "series_id" UUID;

-- CreateIndex
CREATE INDEX "expenses_series_id_idx" ON "expenses"("series_id");
