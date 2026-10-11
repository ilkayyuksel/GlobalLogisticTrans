-- One truck per driver, enforced by the database as well as by the service.
--
-- The vehicle side has had this since the start
-- ("vehicle_assignment_active_vehicle_key"). The driver side was checked only
-- by the service, which reads before it writes, so two concurrent links could
-- both pass. The index makes the second one fail and roll back.
--
-- Existing rows are NOT changed. If a driver already holds two open-ended
-- assignments the migration stops and names the problem instead of choosing
-- which one to end: that is a decision for a person.

-- Guard
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "vehicle_assignment"
        WHERE "valid_to" IS NULL
        GROUP BY "driver_id"
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'vehicle_assignment: a driver holds more than one open-ended assignment. End all but one by hand before applying this migration.';
    END IF;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_assignment_active_driver_key"
    ON "vehicle_assignment" ("driver_id") WHERE "valid_to" IS NULL;

-- AlterCheckConstraint
-- An assignment ended or replaced on the day it starts is kept as history with
-- valid_to = valid_from - 1: in effect on no day, never deleted. Anything
-- earlier than that is still refused.
ALTER TABLE "vehicle_assignment"
    DROP CONSTRAINT "vehicle_assignment_date_range_check";

ALTER TABLE "vehicle_assignment"
    ADD CONSTRAINT "vehicle_assignment_date_range_check"
    CHECK ("valid_to" IS NULL OR "valid_to" >= "valid_from" - 1);
