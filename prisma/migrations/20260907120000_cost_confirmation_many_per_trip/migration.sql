-- A Trip may hold SEVERAL cost confirmations.
--
-- `cost_confirmation.trip_id` was UNIQUE, on the rule that Eucon confirms a
-- Trip once and a second confirmation is refused. That is withdrawn:
-- confirmations arrive in instalments and the Trip is worth their SUM, so the
-- constraint has to go before a second row can exist.
--
-- ── NO DATA IS TOUCHED ─────────────────────────────────────────────────────
-- Only indexes change. Every existing row keeps its trip, its document, its
-- cc_number and its amount, and the confirmation each Trip holds today stays
-- exactly where it is — it simply becomes the first of possibly several, and
-- therefore also the latest until another arrives. Nothing is backfilled
-- because nothing needs moving: the rows are already in the right table.
--
-- ── REVERSIBLE ─────────────────────────────────────────────────────────────
-- Recreating the unique index restores the old shape, and it will succeed for
-- as long as no Trip has yet received a second confirmation:
--
--   DROP INDEX "cost_confirmation_trip_id_received_at_idx";
--   CREATE UNIQUE INDEX "cost_confirmation_trip_id_key"
--     ON "cost_confirmation"("trip_id");
--
-- Once a Trip holds two, that reversal fails — correctly, because the second
-- row is real money and dropping it silently is not a rollback.

DROP INDEX "cost_confirmation_trip_id_key";

-- Both readers ask the same question — this Trip's confirmations, newest
-- first — so the index carries the sort as well as the lookup.
CREATE INDEX "cost_confirmation_trip_id_received_at_idx"
  ON "cost_confirmation"("trip_id", "received_at" DESC);
