-- Where a Custom Property assignment came from.
--
-- A domain rule now assigns "Flat" to every Trip whose container type is 20FL
-- or 20ST, and withdraws it again when the container type changes to something
-- that does not require it. Withdrawing needs to know which assignments the
-- rule is allowed to touch: removing one an operator chose by hand would delete
-- a deliberate decision on the strength of a rule that knows nothing about it.
--
-- DEFAULT false is what makes this safe without a backfill. Every row that
-- exists today was created by a person through the assignment endpoint — there
-- has never been any other writer — so "manual" is not an assumption, it is the
-- only thing those rows can be. In particular the Flat assignments already
-- sitting on finished 45PH Trips stay manual and stay untouched.

-- AlterTable
ALTER TABLE "trip_custom_property" ADD COLUMN "is_automatic" BOOLEAN NOT NULL DEFAULT false;
