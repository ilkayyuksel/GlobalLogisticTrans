-- Route prices carry a DISTANCE and no longer carry a state.
--
-- Two changes to configuration only. No TripPricing snapshot and no pricing
-- item is read, written or deleted here: a Trip already priced keeps the
-- amounts it was priced with, including the toll it was charged.
--
-- ── 1. THE ROUTE'S LENGTH ──────────────────────────────────────────────────
-- Toll stops being an amount stored per route and becomes kilometres times the
-- configured rate (PRICING.TOLL_RATE_PER_KM). The distance is added here as
-- NULL for every existing route, and it is left null deliberately:
--
--   a stored toll amount does NOT say how long the road is. Dividing one by
--   the new rate would be arithmetic on two unrelated numbers and would invent
--   a distance nobody measured — and the rate was only introduced days ago, so
--   there is not even a historical rate to divide by.
--
-- A route with no distance is charged no toll, which is the same silence an
-- unconfigured route has always produced. An operator states the real distance
-- on Settings → Prijzen, and the first Trip priced afterwards uses it.
--
-- The old toll amounts are NOT deleted: `route_cost` keeps its TOLL rows, so
-- whoever fills in the distances can still see what each route used to cost.
-- Nothing reads them any more.
ALTER TABLE "route_pricing" ADD COLUMN "kilometres" DECIMAL(8,2);

-- ── 2. NO MORE ACTIVE / INACTIVE ───────────────────────────────────────────
-- A route price exists or it does not; there is no third state, and the screen
-- has a Verwijderen action instead of a switch.
--
-- An inactive route is therefore DELETED rather than silently revived. Keeping
-- it would make it live again the moment the flag stopped being read, and a
-- route nobody has priced with for months would start charging Trips without
-- anyone asking for it. Deleting it is what "inactive" already meant.
--
-- Their route costs go with them, for the same reason: a tunnel cost left
-- behind on a route that no longer exists would keep being matched by
-- departure and destination and would charge a Trip on its own.
DELETE FROM "route_cost"
WHERE EXISTS (
  SELECT 1
  FROM "route_pricing"
  WHERE "route_pricing"."departure" = "route_cost"."departure"
    AND "route_pricing"."destination" = "route_cost"."destination"
    AND "route_pricing"."is_active" = false
)
AND NOT EXISTS (
  -- Unless an ACTIVE route still runs the same road, in which case the cost
  -- belongs to that one.
  SELECT 1
  FROM "route_pricing"
  WHERE "route_pricing"."departure" = "route_cost"."departure"
    AND "route_pricing"."destination" = "route_cost"."destination"
    AND "route_pricing"."is_active" = true
);

DELETE FROM "route_pricing" WHERE "is_active" = false;

-- The partial index existed only to let an inactive duplicate sit beside an
-- active one. With no flag there are no duplicates to allow.
DROP INDEX IF EXISTS "route_pricing_departure_destination_active_key";
DROP INDEX IF EXISTS "route_pricing_is_active_idx";

ALTER TABLE "route_pricing" DROP COLUMN "is_active";

-- A route is the departure/destination pair, as it always was — now without a
-- condition, because there is no state that could make a second one legitimate.
CREATE UNIQUE INDEX "route_pricing_departure_destination_key"
    ON "route_pricing" ("departure", "destination");
