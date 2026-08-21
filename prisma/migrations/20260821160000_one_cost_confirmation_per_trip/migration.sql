-- A Trip has at most ONE confirmed cost.
--
-- The previous constraint, UNIQUE (trip_id, cc_number), only stopped the SAME
-- confirmation being recorded twice. It still allowed two different Eucon
-- numbers on one Trip, which the business does not have: the first
-- confirmation is the authoritative one and a later, different one is refused.
--
-- The plain index on trip_id goes with it: the unique index serves those
-- lookups.

-- DropIndex
DROP INDEX "cost_confirmation_trip_id_cc_number_key";

-- DropIndex
DROP INDEX "cost_confirmation_trip_id_idx";

-- CreateIndex
CREATE UNIQUE INDEX "cost_confirmation_trip_id_key" ON "cost_confirmation"("trip_id");
