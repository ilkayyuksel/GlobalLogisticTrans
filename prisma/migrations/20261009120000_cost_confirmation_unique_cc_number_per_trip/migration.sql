-- The SAME Cost Confirmation is stored at most once per Trip.
--
-- `CostConfirmationService.record` already refuses a `cc_number` the Trip
-- holds, but it checks and then inserts: two imports of one document running
-- at the same moment (an IMAP scan and a manual upload, or a retry overlapping
-- the first attempt) can both find nothing and both insert. The amount would
-- then count twice in EK. This index is what still holds in that race; the
-- service answers the refused insert as ALREADY_RECORDED.
--
-- Different numbers for one Trip stay allowed: a Trip is confirmed in
-- instalments and is worth their sum.
--
-- ── NO DATA IS TOUCHED ─────────────────────────────────────────────────────
-- Existing duplicates are NOT deleted or merged here. Each row carries its own
-- document and its own received_at, and which of two rows is the "real" one is
-- not something a migration can decide. So the migration first checks, and
-- STOPS before creating the index when any (trip_id, cc_number) occurs more
-- than once. Nothing is changed in that case; list the rows with
--
--   SELECT trip_id, cc_number, count(*) AS copies,
--          array_agg(id ORDER BY created_at) AS ids
--   FROM cost_confirmation
--   GROUP BY trip_id, cc_number
--   HAVING count(*) > 1;
--
-- resolve them deliberately, and run the migration again.
--
-- ── REVERSIBLE ─────────────────────────────────────────────────────────────
--   DROP INDEX "cost_confirmation_trip_id_cc_number_key";

DO $$
DECLARE
  duplicate_count integer;
BEGIN
  SELECT count(*) INTO duplicate_count
  FROM (
    SELECT 1
    FROM cost_confirmation
    GROUP BY trip_id, cc_number
    HAVING count(*) > 1
  ) AS duplicates;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION
      'cost_confirmation holds % duplicated (trip_id, cc_number) combination(s). The unique index was NOT created and no row was changed. Resolve the duplicates first; see the query in this migration.',
      duplicate_count;
  END IF;
END
$$;

-- CreateIndex
CREATE UNIQUE INDEX "cost_confirmation_trip_id_cc_number_key" ON "cost_confirmation"("trip_id", "cc_number");
