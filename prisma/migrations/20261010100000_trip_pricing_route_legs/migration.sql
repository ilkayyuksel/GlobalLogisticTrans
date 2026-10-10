-- Which configured route a snapshot was priced against, as it was then.
--
-- `trip_pricing.route_pricing_id` alone names a configuration that may since
-- have been changed or removed, and says nothing about the other leg of a
-- Combination. So a snapshot now keeps the road(s) it matched — one row for
-- an ordinary route, both legs of the selected pair for a Combination — and
-- the Combination it selected. Only what explains the match is copied, never
-- the configured amounts: those are the snapshot's own items.
--
-- Nothing is backfilled: an existing snapshot has no rows here, and the API
-- reports its match as not recorded rather than matching it again today.

-- AlterTable
ALTER TABLE "trip_pricing" ADD COLUMN     "combination_route_group_id" UUID;

-- CreateTable
CREATE TABLE "trip_pricing_route_leg" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "trip_pricing_id" UUID NOT NULL,
    "leg_position" SMALLINT,
    "is_priced_leg" BOOLEAN NOT NULL,
    "route_pricing_id" UUID NOT NULL,
    "departure" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "match_method" "route_match_method" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_pricing_route_leg_pkey" PRIMARY KEY ("id"),
    -- A leg is the outbound or the return; an ordinary route has no position.
    CONSTRAINT "trip_pricing_route_leg_position_check" CHECK ("leg_position" IS NULL OR "leg_position" IN (1, 2))
);

-- CreateIndex
CREATE UNIQUE INDEX "trip_pricing_route_leg_trip_pricing_id_leg_position_key" ON "trip_pricing_route_leg"("trip_pricing_id", "leg_position");

-- AddForeignKey
ALTER TABLE "trip_pricing_route_leg" ADD CONSTRAINT "trip_pricing_route_leg_trip_pricing_id_fkey" FOREIGN KEY ("trip_pricing_id") REFERENCES "trip_pricing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
