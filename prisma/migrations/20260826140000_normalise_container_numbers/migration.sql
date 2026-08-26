-- Container numbers become canonical: the identifier only, no formatting.
--
-- A document prints `EUCU 145129/5` for a human to read; the identity is
-- `EUCU1451295`. Until both sides were reduced to one form, matching an UPDATE
-- or a CANCEL against a stored Trip compared typography rather than identity.
--
-- The parser now emits the canonical form and the Backend canonicalises what an
-- operator types, so this brings the rows written before that into line.
--
-- AUDITED BEFORE WRITING. Three non-null container numbers existed; two change;
-- no two Trips become the same (booking_number, container_number) afterwards,
-- so `trip_identity_key` cannot be violated and nothing has to be merged. Had
-- there been a collision this migration would not exist — merging Trips is a
-- decision for a person, never for a migration.
--
-- ONLY the container column. Booking numbers are deliberately untouched: one
-- prints as `ANRDUB2794719 /67036944`, where the slash separates the booking
-- from the trip number, and stripping it would fuse two identifiers into one.
UPDATE "trip"
SET "container_number" = translate("container_number", ' /' || chr(92), '')
WHERE "container_number" IS NOT NULL
  AND "container_number" <> translate("container_number", ' /' || chr(92), '');
