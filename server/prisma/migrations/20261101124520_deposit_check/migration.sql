ALTER TABLE "bookings" ADD CONSTRAINT "bookings_deposit_non_negative" CHECK ("deposit_amount" >= 0);
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_reschedule_count_non_negative" CHECK ("reschedule_count" >= 0);
