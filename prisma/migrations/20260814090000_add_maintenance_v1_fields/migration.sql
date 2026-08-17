-- Maintenance V1: the four fields an Administrator fills in by hand.
--
-- All four are NULLABLE, including maintenance_type. Existing rows predate
-- them and there is no honest value to backfill: a maintenance record whose
-- kind of work was never recorded is unknown, not "Onderhoud".
--
-- mileage and next_maintenance_mileage are odometer readings the Administrator
-- ENTERS. Nothing in this system tracks a vehicle's current mileage, and these
-- columns must never be read as if it did — mileage is what the odometer said
-- when this work was done, and next_maintenance_mileage is when the next work
-- is planned.

-- AlterTable
ALTER TABLE "maintenance" ADD COLUMN     "maintenance_type" TEXT;
ALTER TABLE "maintenance" ADD COLUMN     "mileage" INTEGER;
ALTER TABLE "maintenance" ADD COLUMN     "next_maintenance_date" DATE;
ALTER TABLE "maintenance" ADD COLUMN     "next_maintenance_mileage" INTEGER;

-- CreateIndex
CREATE INDEX "maintenance_next_maintenance_date_idx" ON "maintenance"("next_maintenance_date");

-- ---------------------------------------------------------------------------
-- Hand-written DDL: constraints Prisma's schema language cannot express.
-- ---------------------------------------------------------------------------

-- An odometer never runs backwards past zero. Enforced in the database because
-- a negative reading is meaningless in every caller, present and future, and a
-- DTO only guards the callers that exist today.
ALTER TABLE "maintenance"
  ADD CONSTRAINT "maintenance_mileage_not_negative"
  CHECK ("mileage" IS NULL OR "mileage" >= 0);

ALTER TABLE "maintenance"
  ADD CONSTRAINT "maintenance_next_mileage_not_negative"
  CHECK ("next_maintenance_mileage" IS NULL OR "next_maintenance_mileage" >= 0);
