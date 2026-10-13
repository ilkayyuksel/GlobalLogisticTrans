-- Where a Trip's stored driver came from (owner's rule, 13 October 2026).
--
-- A Trip not yet finished follows the driver its vehicle has on its planning
-- date; only a driver CHOSEN for the Trip (MANUAL) stays. A finished Trip keeps
-- the driver it had: the system stores it as AUTOMATIC before an assignment
-- change would move it.
--
-- Every driver_id that exists now predates this column. Some were chosen by an
-- operator, some were stored automatically by the pinning of 11 October, and
-- nothing in the data tells which. They are labelled UNKNOWN — not guessed —
-- and UNKNOWN is protected exactly like MANUAL: no driver_id is changed here or
-- later by any automatic path.

-- CreateEnum
CREATE TYPE "trip_driver_source" AS ENUM ('MANUAL', 'AUTOMATIC', 'UNKNOWN');

-- AlterTable
ALTER TABLE "trip" ADD COLUMN "driver_source" "trip_driver_source";

-- Label, never change: the driver_id values themselves are untouched.
UPDATE "trip" SET "driver_source" = 'UNKNOWN' WHERE "driver_id" IS NOT NULL;

-- AddCheckConstraint
ALTER TABLE "trip"
    ADD CONSTRAINT "trip_driver_source_check"
    CHECK (("driver_id" IS NULL) = ("driver_source" IS NULL));
