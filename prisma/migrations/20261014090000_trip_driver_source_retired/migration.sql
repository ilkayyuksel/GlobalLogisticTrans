-- Retires trip.driver_source (owner's decision, 14 October 2026).
--
-- The rule it served — unfinished Trips follow the vehicle's driver, only
-- finished Trips store theirs — was withdrawn the day after it was introduced.
-- The earlier rule is back: a Trip's driver is stored when it is planned and
-- kept through every later change, and nothing reads or writes driver_source.
--
-- NON-DESTRUCTIVE on purpose. 20261013090000_trip_driver_source may already
-- have been applied in a shared environment, so it is not removed or rewritten,
-- and the column and its values stay. Only the CHECK that tied the column to
-- driver_id is dropped: with it, the restored code could not store a driver_id
-- without a source. No row is changed.

-- DropCheckConstraint
ALTER TABLE "trip" DROP CONSTRAINT IF EXISTS "trip_driver_source_check";

COMMENT ON COLUMN "trip"."driver_source" IS
    'Retired 2026-10-14: no longer read or written. Kept to preserve migration history and data.';
