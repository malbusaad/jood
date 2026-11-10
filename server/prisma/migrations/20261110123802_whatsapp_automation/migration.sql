-- CreateEnum
CREATE TYPE "WaMessageKind" AS ENUM ('REQUEST_RECEIVED', 'BOOKING_ACCEPTED', 'PAYMENT_CONFIRMED', 'REMINDER', 'ACCESS', 'PAYMENT_PENDING', 'THANK_YOU');

-- CreateEnum
CREATE TYPE "WaMessageStatus" AS ENUM ('SCHEDULED', 'SENDING', 'SENT', 'FAILED', 'SKIPPED', 'BLOCKED', 'DRY_RUN');

-- CreateTable
CREATE TABLE "whatsapp_messages" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "kind" "WaMessageKind" NOT NULL,
    "status" "WaMessageStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "preview" TEXT,
    "last_error" VARCHAR(500),
    "provider_id" VARCHAR(200),
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_messages_status_scheduled_at_idx" ON "whatsapp_messages"("status", "scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_messages_booking_id_kind_key" ON "whatsapp_messages"("booking_id", "kind");

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
