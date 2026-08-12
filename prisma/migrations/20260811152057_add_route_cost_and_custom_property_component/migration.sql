-- AlterTable
ALTER TABLE "custom_property" ADD COLUMN     "pricing_component_id" UUID;

-- CreateTable
CREATE TABLE "route_cost" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "departure" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "pricing_component_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "route_cost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "route_cost_departure_destination_idx" ON "route_cost"("departure", "destination");

-- CreateIndex
CREATE INDEX "route_cost_pricing_component_id_idx" ON "route_cost"("pricing_component_id");

-- AddForeignKey
ALTER TABLE "custom_property" ADD CONSTRAINT "custom_property_pricing_component_id_fkey" FOREIGN KEY ("pricing_component_id") REFERENCES "pricing_component"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_cost" ADD CONSTRAINT "route_cost_pricing_component_id_fkey" FOREIGN KEY ("pricing_component_id") REFERENCES "pricing_component"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written DDL: constraints database_schema.md requires that Prisma's
-- schema language cannot express.
-- ---------------------------------------------------------------------------

-- Partial unique index: a PricingComponent may be reached through at most one
-- ACTIVE Custom Property. Two would let one charge produce two pricing lines.
-- Scoped to active rows so a deactivated property keeps its link and historical
-- Trips stay readable. NULLs are distinct in PostgreSQL, so any number of
-- fixed-price properties may coexist.
CREATE UNIQUE INDEX "custom_property_pricing_component_active_key"
    ON "custom_property" ("pricing_component_id")
    WHERE "is_active" AND "pricing_component_id" IS NOT NULL;

-- A route-priced Custom Property carries no price of its own. A value in
-- default_price would silently never be used, so it is forbidden outright
-- rather than ignored.
ALTER TABLE "custom_property"
    ADD CONSTRAINT "custom_property_linked_has_no_default_price_check"
    CHECK ("pricing_component_id" IS NULL OR "default_price" IS NULL);

-- Partial unique index: one active amount per component per route.
CREATE UNIQUE INDEX "route_cost_route_component_active_key"
    ON "route_cost" ("departure", "destination", "pricing_component_id")
    WHERE "is_active";

-- Negative pricing is not supported (pricing_rules.md, Business Constraints).
ALTER TABLE "route_cost"
    ADD CONSTRAINT "route_cost_amount_check"
    CHECK ("amount" >= 0);
