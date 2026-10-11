-- What became of a grouped Trip's Combination pair when it was priced.
--
-- A Trip in a group is priced as a leg of a configured Combination when its
-- pair of roads names exactly one; otherwise on ordinary routes. The snapshot
-- now records which, and why not: a group priced on ordinary routes is never
-- shown as a Combination, and a pair that was expected but not configured is
-- told apart from a group that has no pair at all.
--
-- NULL for a Trip in no group, and on every existing snapshot: nothing is
-- backfilled or recalculated.

-- CreateEnum
CREATE TYPE "combination_match_outcome" AS ENUM ('MATCHED', 'NO_PAIR', 'LEG_NOT_IDENTIFIED', 'PAIR_NOT_CONFIGURED', 'AMBIGUOUS');

-- AlterTable
ALTER TABLE "trip_pricing" ADD COLUMN     "combination_match" "combination_match_outcome";
