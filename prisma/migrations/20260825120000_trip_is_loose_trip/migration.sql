-- LOSRIT: an operator's classification of a Trip, not a lifecycle state.
--
-- A separate column rather than a TripStatus value, because the two are
-- independent: a Trip is LOSRIT *and* OPEN, or LOSRIT *and* CLOSED. Adding it
-- to the enum would have made those combinations unrepresentable.
--
-- DEFAULT false, so every existing Trip is an ordinary Trip. Nothing is
-- backfilled and nothing is inferred from another column: LOSRIT is stated by
-- the operator or it is not true.
ALTER TABLE "trip"
  ADD COLUMN "is_loose_trip" BOOLEAN NOT NULL DEFAULT false;
