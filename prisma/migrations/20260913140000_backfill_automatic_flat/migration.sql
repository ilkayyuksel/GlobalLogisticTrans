-- Automatic Flat for Trips that existed before their container type required it.
--
-- The Flat rule (apps/backend/src/trips/flat-container-rule.ts) assigns the
-- "Flat" Custom Property when a Trip is created or revised. It runs on writes,
-- not retroactively, so when the rule was extended to 45FL and 45OS in
-- September 2026 the Trips that already carried those types were left without
-- it. This writes exactly the assignment the rule would have written, for every
-- container type the rule names today:
--
--   * automatic (is_automatic = true), so the rule may still withdraw it;
--   * only where the Trip carries no Flat at all, so a manual one is untouched;
--   * nothing at all when no active "Flat" property is configured.
--
-- No stored price is changed. An OPEN Trip is priced with Flat when it closes; a
-- CLOSED Trip keeps its snapshot until something prices it again — a reprocess,
-- a regrouping, or an edit of one of its pricing inputs.
INSERT INTO "trip_custom_property" ("trip_id", "custom_property_id", "is_automatic")
SELECT trip."id", flat."id", true
FROM "trip" AS trip
CROSS JOIN (
  SELECT "id" FROM "custom_property" WHERE "name" = 'Flat' AND "is_active" = true
) AS flat
WHERE upper(btrim(trip."container_type")) IN ('20FL', '20ST', '40FL', '40OS', '45FL', '45OS')
  AND NOT EXISTS (
    SELECT 1
    FROM "trip_custom_property" AS assigned
    WHERE assigned."trip_id" = trip."id"
      AND assigned."custom_property_id" = flat."id"
  );
