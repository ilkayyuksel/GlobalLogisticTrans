-- Route prices: the Toll is an AMOUNT per route again, and a Combination gains
-- Over ST.
--
-- Configuration only. No TripPricing snapshot and no pricing item is read,
-- written or deleted here: a Trip already priced keeps every amount it was
-- priced with, including a toll derived from kilometres, whose line records the
-- distance and the rate it used.
--
-- ── 1. TOLL: BACK TO THE STORED ROUTE AMOUNTS ──────────────────────────────
-- The toll was briefly kilometres x PRICING.TOLL_RATE_PER_KM. It is read again
-- from the TOLL rows of `route_cost`, exactly like the Tunnel. Those rows were
-- never deleted when the distance was introduced — they were kept precisely so
-- what each route used to cost stays visible — so NO data moves here: the
-- Pricing Engine simply reads them again, as decided by the business.
--
-- `route_pricing.kilometres` is KEPT, unused, so the distances entered in that
-- period are not lost. Nothing converts them into toll amounts.
--
-- The global rate is switched OFF rather than deleted: settings are never
-- deleted, and its value stays readable for the record.
UPDATE "setting"
   SET "is_active" = false
 WHERE "category" = 'PRICING'
   AND "key" = 'TOLL_RATE_PER_KM';

-- ── 2. OVER ST ─────────────────────────────────────────────────────────────
-- The Combination's own Tarief, Toll and Tunnel, on the group: it is part of
-- one Combination and has no route of its own. NULL for every existing
-- Combination — nobody has stated these amounts, and none is invented.
ALTER TABLE "combination_route_group"
  ADD COLUMN "over_st_base_price" DECIMAL(12,2),
  ADD COLUMN "over_st_toll"       DECIMAL(12,2),
  ADD COLUMN "over_st_tunnel"     DECIMAL(12,2);

ALTER TABLE "combination_route_group"
  ADD CONSTRAINT "combination_route_group_over_st_non_negative" CHECK (
    ("over_st_base_price" IS NULL OR "over_st_base_price" >= 0) AND
    ("over_st_toll"       IS NULL OR "over_st_toll"       >= 0) AND
    ("over_st_tunnel"     IS NULL OR "over_st_tunnel"     >= 0)
  );
