-- Trip direction: which half of a transport a Trip is.
--
-- The parser has always known this — a transport order states it, as a LOADING
-- or a DELIVERY section — but it survived only inside `trip.parser_metadata`,
-- which is diagnostics and which no business decision may read. The Combination
-- export has to label a leg's start and end points by it, so it becomes a real
-- column.
--
-- Nullable, for two reasons that are both permanent rather than transitional:
-- a Trip created by hand has no document to have said which it is, and every
-- Trip imported before this column existed keeps working untouched.
--
-- Existing rows are deliberately NOT backfilled here. The value for them sits
-- in parser_metadata, and moving it is a data migration with its own decisions
-- to make — it belongs in its own step, not hidden inside a schema change.

CREATE TYPE "trip_direction" AS ENUM ('COLLECTION', 'DELIVERY');

ALTER TABLE "trip" ADD COLUMN "direction" "trip_direction";
