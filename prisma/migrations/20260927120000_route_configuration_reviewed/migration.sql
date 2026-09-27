-- Administrative progress: has somebody been through this route's prices?
--
-- ── WHAT THIS IS NOT ────────────────────────────────────────────────────────
-- Not an active flag, not a status, not a lifecycle. The Pricing Engine never
-- reads either column: an unreviewed route prices exactly as a reviewed one
-- does, and no Trip, snapshot or pricing line is touched by any of this. It
-- records that a person has looked, so an administrator working through a long
-- price list can see where they got to.
--
-- ── EXISTING ROWS ARE UNREVIEWED ────────────────────────────────────────────
-- DEFAULT false with NOT NULL, so every row that already exists is filled in as
-- false: nothing already configured is claimed to have been checked. That is the
-- whole point of the flag, and a default of true would destroy it silently on the
-- first deployment.
ALTER TABLE "route_pricing"
    ADD COLUMN "reviewed" BOOLEAN NOT NULL DEFAULT false;

-- The mark of a Combination lives on the GROUP, because the group is what a
-- person configures, edits, removes and therefore reviews. A leg's own column
-- above is never read: half a reviewed Combination is not a state this
-- application can show or act on.
ALTER TABLE "combination_route_group"
    ADD COLUMN "reviewed" BOOLEAN NOT NULL DEFAULT false;
