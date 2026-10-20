-- Whether a pricing line is the Engine's own AUTOMATIC charge of a Custom
-- Property (TAR), as opposed to one an operator assigned by hand.
--
-- The automatic TAR of one number is charged once a day, and the Trip holding
-- it is found by its pricing lines. A manual TAR is a line of the same
-- property, so without this mark the two could only be told apart by comparing
-- the snapshot with the Trip's CURRENT assignments — which diverge while a Trip
-- is reopened and not repriced. From now on the mark is written with the line,
-- by the calculation that produced it.

-- AlterTable
ALTER TABLE "trip_pricing_item" ADD COLUMN "is_automatic" BOOLEAN NOT NULL DEFAULT false;

-- ── BACKFILL: SNAPSHOTS STORED BEFORE THE MARK EXISTED ─────────────────────
-- Only evidence the stored rows actually hold is used: how many lines of the
-- automatic property a snapshot has (at most one manual + one automatic), and
-- whether the Trip's manual assignment of it was created before or after the
-- snapshot was calculated (`trip_custom_property.created_at` against
-- `trip_pricing.calculated_at`). An assigned TAR is always priced.
--
--   2 lines                                   one is automatic          certain
--   1 line, assigned BEFORE the calculation   the manual one            certain
--   1 line, assigned AFTER the calculation    not that assignment:      evidence
--                                             automatic
--   1 line, no assignment now                 automatic — unless a manual
--                                             assignment was removed later
--                                             without repricing, which
--                                             leaves no trace
--
-- The last case is certain only for a CLOSED Trip whose snapshot is current:
-- removing a property from a CLOSED Trip reprices it. For a reopened,
-- cancelled or deleted Trip, or a FAILED snapshot, it cannot be reconstructed.
-- Such lines are marked automatic — what the snapshot shows, and how the
-- system read them until now — and are listed for review by
-- `docs/05-pricing/tar-diagnose.sql`; repricing the Trip (closing it again, or
-- "Prijs herberekenen") replaces them with lines the Engine marks itself.
WITH automatic_property AS (
  SELECT value::uuid AS id
  FROM "setting"
  WHERE category = 'PRICING'
    AND key = 'AUTOMATIC_CUSTOM_PROPERTY_ID'
    AND value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
),
property_lines AS (
  SELECT
    item.id,
    pricing.trip_id,
    pricing.calculated_at,
    row_number() OVER (PARTITION BY item.trip_pricing_id ORDER BY item.calculation_order, item.id) AS position,
    count(*) OVER (PARTITION BY item.trip_pricing_id) AS line_count
  FROM "trip_pricing_item" item
  JOIN "trip_pricing" pricing ON pricing.id = item.trip_pricing_id
  JOIN automatic_property property ON property.id = item.custom_property_id
)
UPDATE "trip_pricing_item"
SET is_automatic = true
FROM property_lines
LEFT JOIN "trip_custom_property" assignment
  ON assignment.trip_id = property_lines.trip_id
 AND assignment.custom_property_id = (SELECT id FROM automatic_property)
WHERE "trip_pricing_item".id = property_lines.id
  AND property_lines.position = 1
  AND (
    property_lines.line_count >= 2
    OR assignment.id IS NULL
    OR assignment.created_at > property_lines.calculated_at
  );
