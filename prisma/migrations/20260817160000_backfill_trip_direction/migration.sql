-- One-time backfill: the direction of Trips imported before the column existed.
--
-- The parser has always recorded which half of a transport a Trip is, but until
-- `trip.direction` was added it survived only inside `parser_metadata`. The
-- Trips imported before that change therefore have a null column and a perfectly
-- good value sitting in their evidence.
--
-- This copies that value across, and nothing else:
--
--   * only where the column is still NULL, so a value set by the importer is
--     never overwritten — which also makes re-running this harmless;
--   * only where the metadata holds one of the two real directions, so a
--     malformed or absent value is left null rather than guessed at;
--   * only for IMPORTED Trips (pdf_document_id IS NOT NULL). A Trip created by
--     hand has no document that could have stated a direction, and a manual
--     Trip must never acquire one.
--
-- Nothing is inferred from a terminal, a destination, a date, a booking number
-- or a row order. If the parser did not say it, it stays null.

UPDATE "trip"
SET "direction" = ("parser_metadata" ->> 'direction')::"trip_direction"
WHERE "direction" IS NULL
  AND "pdf_document_id" IS NOT NULL
  AND "parser_metadata" ->> 'direction' IN ('COLLECTION', 'DELIVERY');
