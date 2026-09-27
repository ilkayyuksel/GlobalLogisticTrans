-- A road may be a leg of MORE THAN ONE Combination configuration.
--
-- Configuration only. No TripPricing snapshot, no pricing item and no Trip is
-- read, written or deleted here: a Trip already priced keeps the amounts it was
-- priced with.
--
-- ── WHAT WAS WRONG ─────────────────────────────────────────────────────────
-- `route_pricing_combination_route_key` made (departure, destination) unique
-- across every Combination leg in the system, which said: one road may be a leg
-- of at most one Combination. That is not the business rule. Everything leaving
-- MPET 1742 shares its outbound, and each of those is a Combination of its own
-- with its own return — so configuring the second one was impossible, and a bulk
-- import of 209 Combinations out of a handful of terminals could never be
-- accepted.
--
-- ── WHAT THE IDENTITY OF A COMBINATION ACTUALLY IS ─────────────────────────
-- Its PAIR of legs. `Quay 869 → Lessines` with `Lessines → Quay 869` is one
-- configuration; the same outbound with a different return is another. A single
-- leg is not a configuration at all — it has no meaning without its partner.
--
-- That rule spans TWO rows of route_pricing, so no unique index can express it:
-- it is enforced by CombinationRoutePricingService, which is the one path every
-- write takes (the screen, the single-route API and the bulk import all reach
-- it), inside the transaction that writes the group.
DROP INDEX IF EXISTS "route_pricing_combination_route_key";

-- What remains true per row: the two legs of ONE Combination may not describe
-- the same road. Pricing selects a leg by its road, so a group holding one road
-- twice would make the choice between its own legs arbitrary — and that IS
-- expressible, scoped to the group.
--
-- Deliberately not unscoped: that is precisely the constraint being removed.
CREATE UNIQUE INDEX "route_pricing_combination_group_route_key"
    ON "route_pricing" ("combination_group_id", "departure", "destination")
    WHERE "combination_group_id" IS NOT NULL;

-- Untouched, and named here so it is clear this migration does not touch it:
--   route_pricing_normal_route_key       UNIQUE (departure, destination)
--                                        WHERE combination_group_id IS NULL
-- One ordinary configuration per road, exactly as before. A NORMAL route that is
-- already configured is still refused as `already configured`.
--
-- Also untouched:
--   route_pricing_combination_leg_key    UNIQUE (combination_group_id,
--                                                combination_leg_position)
-- which, with the CHECK restricting the position to 1 or 2, is what keeps a
-- third leg out of a group.
--
-- ── NOTHING TO BACKFILL ────────────────────────────────────────────────────
-- Dropping a unique index cannot invalidate existing data: every row that
-- satisfied the stricter rule satisfies the looser one. The new index is
-- implied by the old one for existing rows, so it cannot fail either.
