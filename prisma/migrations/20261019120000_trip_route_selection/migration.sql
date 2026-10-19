-- An operator's choice of route for a Trip whose automatic match was unusable.
--
-- `trip_pricing` records the OUTCOME of a calculation and is replaced by every
-- recalculation, so it cannot hold a choice that has to survive until the
-- operator or a lifecycle event removes it. The choice is an input to pricing,
-- like a Custom Value, and gets a row of its own.
--
-- Nothing is backfilled: no Trip has a manual choice yet, and every existing
-- snapshot was priced on an automatic match.

-- CreateEnum
CREATE TYPE "route_selection_source" AS ENUM ('AUTOMATIC', 'MANUAL');

-- AlterTable: every existing snapshot came from the automatic matcher.
ALTER TABLE "trip_pricing" ADD COLUMN "route_selection" "route_selection_source" NOT NULL DEFAULT 'AUTOMATIC';

-- CreateTable
CREATE TABLE "trip_route_selection" (
    "trip_id" UUID NOT NULL,
    "route_pricing_id" UUID NOT NULL,
    "selected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "trip_route_selection_pkey" PRIMARY KEY ("trip_id")
);

-- CreateIndex
CREATE INDEX "trip_route_selection_route_pricing_id_idx" ON "trip_route_selection"("route_pricing_id");

-- AddForeignKey: a removed route configuration takes the choice with it.
ALTER TABLE "trip_route_selection" ADD CONSTRAINT "trip_route_selection_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trip_route_selection" ADD CONSTRAINT "trip_route_selection_route_pricing_id_fkey" FOREIGN KEY ("route_pricing_id") REFERENCES "route_pricing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
