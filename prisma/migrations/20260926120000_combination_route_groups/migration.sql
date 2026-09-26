-- Route prices come in two kinds: an ordinary route, and a Combination of two legs.
--
-- Configuration only. No TripPricing snapshot and no pricing item is read,
-- written or deleted here: a Trip already priced keeps the amounts it was priced
-- with, whichever kind of route produced them.
--
-- ── THE GROUP IS A PARENT ROW ──────────────────────────────────────────────
-- A Combination configuration is two legs — an outbound and a return — each
-- with its own price, distance and tunnel, because the two legitimately cost
-- different things. The group identity therefore lives in a row of its own:
-- legs pointing at each other, or a shared text key, would both permit a
-- half-configured Combination to exist.
--
-- This is NOT a TripGroup. A TripGroup is two real Trips an operator put
-- together and it decides the €50 Backload; this decides what the two legs of a
-- Combination COST. Neither reads the other.
CREATE TABLE "combination_route_group" (
    "id"         UUID         NOT NULL DEFAULT gen_random_uuid(),
    "notes"      TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "combination_route_group_pkey" PRIMARY KEY ("id")
);

-- The discriminator. NULL is an ordinary route; set makes the row one leg of the
-- Combination it names. Existing routes are all ordinary ones, so they stay NULL
-- and keep pricing exactly as they do today.
--
-- ON DELETE CASCADE is the group's own rule: removing a Combination removes both
-- its legs, and the database will not leave one behind.
ALTER TABLE "route_pricing"
    ADD COLUMN "combination_group_id" UUID;

ALTER TABLE "route_pricing"
    ADD CONSTRAINT "route_pricing_combination_group_id_fkey"
    FOREIGN KEY ("combination_group_id")
    REFERENCES "combination_route_group"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

CREATE INDEX "route_pricing_combination_group_id_idx"
    ON "route_pricing" ("combination_group_id");

-- ── WHICH LEG IS WHICH ──────────────────────────────────────────────────────
-- 1 is the outbound, 2 the return. `created_at` cannot tell them apart: it is
-- the transaction's timestamp, and the two legs are written in one transaction,
-- so both carry the same value. The operator configured an order and must get
-- it back.
ALTER TABLE "route_pricing"
    ADD COLUMN "combination_leg_position" SMALLINT;

-- A leg has a position and an ordinary route has neither, so neither half of the
-- discriminator can be set without the other.
ALTER TABLE "route_pricing"
    ADD CONSTRAINT "route_pricing_combination_leg_position_pairing_check"
    CHECK (
        ("combination_group_id" IS NULL) = ("combination_leg_position" IS NULL)
    );

-- The upper half of "exactly two legs", enforced by the database rather than by
-- a service: with only two positions available and each unique within its group,
-- a third leg cannot be written at all. The lower half — that both legs exist —
-- is the service's transaction, because no constraint can require a row to have
-- a sibling.
ALTER TABLE "route_pricing"
    ADD CONSTRAINT "route_pricing_combination_leg_position_range_check"
    CHECK (
        "combination_leg_position" IS NULL
        OR "combination_leg_position" IN (1, 2)
    );

CREATE UNIQUE INDEX "route_pricing_combination_leg_key"
    ON "route_pricing" ("combination_group_id", "combination_leg_position")
    WHERE "combination_group_id" IS NOT NULL;

-- ── TWO CONTEXTS, TWO UNIQUENESS RULES ─────────────────────────────────────
-- The unconditional unique index is replaced by one per kind. An ordinary route
-- and a Combination leg may describe the same departure and destination — that
-- is the point, because a Combination's outbound often runs the road an ordinary
-- Trip also runs, and it is priced differently — while neither kind may hold two
-- rows for one road.
--
-- So a Combination leg can never overwrite the ordinary route, and pricing can
-- still select exactly one row in either context.
DROP INDEX IF EXISTS "route_pricing_departure_destination_key";

CREATE UNIQUE INDEX "route_pricing_normal_route_key"
    ON "route_pricing" ("departure", "destination")
    WHERE "combination_group_id" IS NULL;

CREATE UNIQUE INDEX "route_pricing_combination_route_key"
    ON "route_pricing" ("departure", "destination")
    WHERE "combination_group_id" IS NOT NULL;

-- ── A COST MAY NOW BELONG TO A LEG RATHER THAN TO A ROAD ────────────────────
-- Route costs are matched by departure and destination, which answered the
-- question while one road had one configuration. A Combination leg can run the
-- same road as an ordinary route and be priced differently, so the tunnel of
-- that road stopped being a single answer.
--
-- NULL keeps the original meaning — the cost of the road itself — so every
-- existing row keeps behaving exactly as it does today and no value is
-- converted, moved or guessed. Only a Combination leg names its owner.
ALTER TABLE "route_cost"
    ADD COLUMN "route_pricing_id" UUID;

ALTER TABLE "route_cost"
    ADD CONSTRAINT "route_cost_route_pricing_id_fkey"
    FOREIGN KEY ("route_pricing_id")
    REFERENCES "route_pricing"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

CREATE INDEX "route_cost_route_pricing_id_idx"
    ON "route_cost" ("route_pricing_id");

-- One uniqueness rule per owner. A road may hold one active cost per component,
-- and so may a leg — and the two no longer collide, which is what lets a
-- Combination leg carry its own tunnel on a road an ordinary route also uses.
DROP INDEX IF EXISTS "route_cost_route_component_active_key";

CREATE UNIQUE INDEX "route_cost_route_component_active_key"
    ON "route_cost" ("departure", "destination", "pricing_component_id")
    WHERE "is_active" AND "route_pricing_id" IS NULL;

CREATE UNIQUE INDEX "route_cost_leg_component_active_key"
    ON "route_cost" ("route_pricing_id", "pricing_component_id")
    WHERE "is_active" AND "route_pricing_id" IS NOT NULL;
