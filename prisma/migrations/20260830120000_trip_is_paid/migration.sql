-- BETAALD: whether a Trip has been paid.
--
-- A separate column rather than a TripStatus value, for the same reason
-- is_loose_trip is one: the two are independent. A Trip is BETAALD *and* OPEN,
-- or BETAALD *and* CLOSED, or CANCELLED *and* still unpaid. Adding it to the
-- enum would have made those combinations unrepresentable.
--
-- DEFAULT false, so every existing Trip is NIET BETAALD. Nothing is backfilled
-- and nothing is inferred from another column — least of all from a Cost
-- Confirmation, which is a third party's promise to pay rather than a record
-- that payment arrived. Payment is stated by the operator or it is not true.
ALTER TABLE "trip"
  ADD COLUMN "is_paid" BOOLEAN NOT NULL DEFAULT false;
