-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'STAFF');

-- CreateEnum
CREATE TYPE "ResourceKind" AS ENUM ('FULL', 'PART');

-- CreateEnum
CREATE TYPE "PricingRuleKind" AS ENUM ('WEEKDAY', 'SEASON', 'SPECIAL');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('NEW', 'AWAITING_PAYMENT', 'AWAITING_VERIFICATION', 'CONFIRMED', 'CANCELLED', 'REJECTED', 'EXPIRED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "BookingChannel" AS ENUM ('WEBSITE', 'GATHERN', 'MANUAL');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('BANK_TRANSFER', 'GATHERN');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('IMAGE', 'VIDEO', 'LOGO', 'PAYMENT_PROOF');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('NEW_BOOKING', 'PAYMENT_REPORTED', 'BOOKING_CANCELLED', 'SYSTEM');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('NOT_CONFIGURED', 'PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'STAFF',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(300),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "amenities" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "capacity_text" VARCHAR(80),
    "capacity_max" INTEGER,
    "note" VARCHAR(120),
    "icon" VARCHAR(30) NOT NULL DEFAULT 'outdoor',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "amenities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_resources" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "kind" "ResourceKind" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_amenities" (
    "resource_id" UUID NOT NULL,
    "amenity_id" UUID NOT NULL,

    CONSTRAINT "resource_amenities_pkey" PRIMARY KEY ("resource_id","amenity_id")
);

-- CreateTable
CREATE TABLE "resource_conflicts" (
    "id" UUID NOT NULL,
    "resource_a_id" UUID NOT NULL,
    "resource_b_id" UUID NOT NULL,
    "reason" VARCHAR(200),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resource_conflicts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_rules" (
    "id" UUID NOT NULL,
    "resource_id" UUID NOT NULL,
    "kind" "PricingRuleKind" NOT NULL,
    "label" VARCHAR(120),
    "days_of_week" INTEGER[],
    "start_date" DATE,
    "end_date" DATE,
    "price" DECIMAL(10,2) NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guests" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "email" VARCHAR(254),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(20) NOT NULL,
    "guest_id" UUID NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'NEW',
    "channel" "BookingChannel" NOT NULL DEFAULT 'WEBSITE',
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "total_amount" DECIMAL(10,2) NOT NULL,
    "price_breakdown" JSONB NOT NULL,
    "guest_count" INTEGER,
    "guest_notes" TEXT,
    "admin_notes" TEXT,
    "expires_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "confirmed_by_id" UUID,
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_items" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "resource_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "booking_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_locks" (
    "key" VARCHAR(80) NOT NULL,
    "date" DATE NOT NULL,
    "booking_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_locks_pkey" PRIMARY KEY ("key","date")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "reported_at" TIMESTAMP(3),
    "proof_asset_id" UUID,
    "external_ref" VARCHAR(100),
    "note" TEXT,
    "verified_at" TIMESTAMP(3),
    "verified_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest_access_tokens" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guest_access_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" UUID NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "storage_key" VARCHAR(300) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "alt" VARCHAR(200),
    "amenity_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_hero" BOOLEAN NOT NULL DEFAULT false,
    "is_private" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "booking_id" UUID,
    "read_at" TIMESTAMP(3),
    "whatsapp_status" "DeliveryStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "whatsapp_error" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "action" VARCHAR(80) NOT NULL,
    "entity_type" VARCHAR(60) NOT NULL,
    "entity_id" VARCHAR(80),
    "details" JSONB,
    "ip" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "amenities_slug_key" ON "amenities"("slug");

-- CreateIndex
CREATE INDEX "amenities_sort_order_idx" ON "amenities"("sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "booking_resources_slug_key" ON "booking_resources"("slug");

-- CreateIndex
CREATE INDEX "resource_amenities_amenity_id_idx" ON "resource_amenities"("amenity_id");

-- CreateIndex
CREATE INDEX "resource_conflicts_resource_b_id_idx" ON "resource_conflicts"("resource_b_id");

-- CreateIndex
CREATE UNIQUE INDEX "resource_conflicts_resource_a_id_resource_b_id_key" ON "resource_conflicts"("resource_a_id", "resource_b_id");

-- CreateIndex
CREATE INDEX "pricing_rules_resource_id_active_idx" ON "pricing_rules"("resource_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "guests_phone_key" ON "guests"("phone");

-- CreateIndex
CREATE INDEX "guests_name_idx" ON "guests"("name");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_reference_key" ON "bookings"("reference");

-- CreateIndex
CREATE INDEX "bookings_status_idx" ON "bookings"("status");

-- CreateIndex
CREATE INDEX "bookings_start_date_idx" ON "bookings"("start_date");

-- CreateIndex
CREATE INDEX "bookings_guest_id_idx" ON "bookings"("guest_id");

-- CreateIndex
CREATE INDEX "bookings_expires_at_idx" ON "bookings"("expires_at");

-- CreateIndex
CREATE INDEX "booking_items_resource_id_date_idx" ON "booking_items"("resource_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "booking_items_booking_id_resource_id_date_key" ON "booking_items"("booking_id", "resource_id", "date");

-- CreateIndex
CREATE INDEX "booking_locks_booking_id_idx" ON "booking_locks"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_proof_asset_id_key" ON "payments"("proof_asset_id");

-- CreateIndex
CREATE INDEX "payments_booking_id_idx" ON "payments"("booking_id");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "guest_access_tokens_token_hash_key" ON "guest_access_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "guest_access_tokens_booking_id_idx" ON "guest_access_tokens"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_storage_key_key" ON "media_assets"("storage_key");

-- CreateIndex
CREATE INDEX "media_assets_kind_sort_order_idx" ON "media_assets"("kind", "sort_order");

-- CreateIndex
CREATE INDEX "notifications_read_at_idx" ON "notifications"("read_at");

-- CreateIndex
CREATE INDEX "notifications_created_at_idx" ON "notifications"("created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_amenities" ADD CONSTRAINT "resource_amenities_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "booking_resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_amenities" ADD CONSTRAINT "resource_amenities_amenity_id_fkey" FOREIGN KEY ("amenity_id") REFERENCES "amenities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_conflicts" ADD CONSTRAINT "resource_conflicts_resource_a_id_fkey" FOREIGN KEY ("resource_a_id") REFERENCES "booking_resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_conflicts" ADD CONSTRAINT "resource_conflicts_resource_b_id_fkey" FOREIGN KEY ("resource_b_id") REFERENCES "booking_resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "booking_resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_guest_id_fkey" FOREIGN KEY ("guest_id") REFERENCES "guests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_items" ADD CONSTRAINT "booking_items_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_items" ADD CONSTRAINT "booking_items_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "booking_resources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_locks" ADD CONSTRAINT "booking_locks_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_proof_asset_id_fkey" FOREIGN KEY ("proof_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_access_tokens" ADD CONSTRAINT "guest_access_tokens_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_amenity_id_fkey" FOREIGN KEY ("amenity_id") REFERENCES "amenities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────── قيود إضافية على مستوى قاعدة البيانات ───────────

-- رقم الطلب الظاهر للضيف (JD-000001 ...)
CREATE SEQUENCE "booking_reference_seq" START 1;

-- يوجد مورد واحد فقط من نوع «الاستراحة كاملة»
CREATE UNIQUE INDEX "booking_resources_single_full" ON "booking_resources" ("kind") WHERE "kind" = 'FULL';

-- زوج التعارض يُخزَّن مرتبًا ولا يكون المورد متعارضًا مع نفسه
ALTER TABLE "resource_conflicts" ADD CONSTRAINT "resource_conflicts_ordered" CHECK ("resource_a_id" < "resource_b_id");

-- الحجز يمتد يومًا واحدًا على الأقل، والمبالغ غير سالبة
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_dates_valid" CHECK ("end_date" > "start_date");
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_total_non_negative" CHECK ("total_amount" >= 0);
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_guest_count_positive" CHECK ("guest_count" IS NULL OR "guest_count" > 0);
ALTER TABLE "booking_items" ADD CONSTRAINT "booking_items_price_non_negative" CHECK ("price" >= 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive" CHECK ("amount" > 0);

-- قواعد الأسعار
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_price_non_negative" CHECK ("price" >= 0);
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_dates_ordered" CHECK ("start_date" IS NULL OR "end_date" IS NULL OR "end_date" >= "start_date");
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_days_valid" CHECK ("days_of_week" <@ ARRAY[0,1,2,3,4,5,6]);
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_dated_kinds" CHECK ("kind" = 'WEEKDAY' OR ("start_date" IS NOT NULL AND "end_date" IS NOT NULL));

-- الأقفال لا تخص إلا الحجوزات النشطة؛ ولا يمكن حجز قفل لحجز غير نشط
CREATE OR REPLACE FUNCTION "booking_locks_require_active"() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "bookings"
    WHERE "id" = NEW."booking_id"
      AND "status" IN ('NEW', 'AWAITING_PAYMENT', 'AWAITING_VERIFICATION', 'CONFIRMED')
  ) THEN
    RAISE EXCEPTION 'booking % is not active', NEW."booking_id" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "booking_locks_active_only"
  BEFORE INSERT ON "booking_locks"
  FOR EACH ROW EXECUTE FUNCTION "booking_locks_require_active"();

-- عند انتقال الحجز إلى حالة غير نشطة تُحرَّر أقفاله تلقائيًا (في نفس المعاملة)
CREATE OR REPLACE FUNCTION "booking_release_locks"() RETURNS trigger AS $$
BEGIN
  IF NEW."status" NOT IN ('NEW', 'AWAITING_PAYMENT', 'AWAITING_VERIFICATION', 'CONFIRMED')
     AND OLD."status" IN ('NEW', 'AWAITING_PAYMENT', 'AWAITING_VERIFICATION', 'CONFIRMED') THEN
    DELETE FROM "booking_locks" WHERE "booking_id" = NEW."id";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "bookings_release_locks"
  AFTER UPDATE OF "status" ON "bookings"
  FOR EACH ROW EXECUTE FUNCTION "booking_release_locks"();
