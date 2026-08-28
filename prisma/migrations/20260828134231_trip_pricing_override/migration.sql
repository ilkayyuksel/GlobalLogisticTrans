-- CreateTable
CREATE TABLE "trip_pricing_override" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "trip_id" UUID NOT NULL,
    "component_code" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
    "overridden_by" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_pricing_override_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trip_pricing_override_trip_id_idx" ON "trip_pricing_override"("trip_id");

-- CreateIndex
CREATE UNIQUE INDEX "trip_pricing_override_trip_id_component_code_key" ON "trip_pricing_override"("trip_id", "component_code");

-- AddForeignKey
ALTER TABLE "trip_pricing_override" ADD CONSTRAINT "trip_pricing_override_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── The Cost Confirmation pricing component ────────────────────────────────
-- Catalog data rather than structure, but it belongs in this migration: the
-- Engine's new step writes trip_pricing_item rows referencing this row, and the
-- foreign key would refuse them if the deployment order let code run first.
--
-- Guarded rather than unconditional. `pricing_component.code` carries no unique
-- constraint, so a plain INSERT would add a second COST_CONFIRMATION on any
-- database where the seed had already created one.
INSERT INTO "pricing_component" ("code", "name", "description", "display_order", "is_active")
SELECT 'COST_CONFIRMATION',
       'Cost Confirmation',
       'The cost Eucon confirmed for this Trip, taken from its Cost Confirmation document. Presented as EK.',
       9,
       true
WHERE NOT EXISTS (
  SELECT 1 FROM "pricing_component" WHERE "code" = 'COST_CONFIRMATION'
);
