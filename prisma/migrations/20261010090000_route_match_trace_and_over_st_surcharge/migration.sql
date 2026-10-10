-- Route matching becomes traceable, and Over ST gets its fixed surcharge.
--
-- ── WHICH ROUTE A PRICE CAME FROM ──────────────────────────────────────────
-- A snapshot now records the configured route it took its Tarief, Toll and
-- Tunnel from, and how that route was matched. NOT_FOUND and AMBIGUOUS mean
-- the route components are zero because nothing reliable matched — a
-- different fact from a configured route priced at zero. Both columns are
-- NULL on every existing snapshot: nothing is backfilled or recalculated.
-- `route_pricing_id` has no foreign key on purpose: a configuration may later
-- be changed or removed, and the snapshot stays the record of what was used.
--
-- ── THE OVER ST SURCHARGE ──────────────────────────────────────────────────
-- When Over ST applies to Leg 2 of a Combination, Leg 2's Tarief carries a
-- fixed extra on top of the configured Over ST amounts. It is a pricing
-- Setting like the Combination Surcharge, 70.00 by default. Inserted here
-- because the Engine requires every pricing Setting: a database without it
-- could price nothing. An existing row (an administrator's value) is kept.
-- Like every pricing Setting, changing it never reprices a finished Trip.

-- CreateEnum
CREATE TYPE "route_match_method" AS ENUM ('EXACT', 'NORMALIZED', 'FUZZY', 'NOT_FOUND', 'AMBIGUOUS');

-- AlterTable
ALTER TABLE "trip_pricing" ADD COLUMN     "route_match" "route_match_method",
ADD COLUMN     "route_pricing_id" UUID;

-- The Over ST surcharge Setting
INSERT INTO "setting" ("category", "key", "value", "value_type", "description", "default_value", "is_active")
VALUES (
  'PRICING',
  'OVER_ST_SURCHARGE',
  '70.00',
  'DECIMAL',
  'Added once to the Tarief of Leg 2 of a Combination when Over ST applies: the two legs are planned on different days and the Combination has Over ST configured. Never added otherwise.',
  '70.00',
  true
)
ON CONFLICT ("category", "key") DO NOTHING;
