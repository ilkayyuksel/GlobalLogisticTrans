-- Over ST / €70 — diagnose (alleen lezen, wijzigt niets).
-- Een handmatige tariefcorrectie is geen oorzaak: Over ST en de €70 blijven
-- er altijd bovenop (zie effective-pricing.ts).
--
-- Toont elke CLOSED rit in een groep die op een LATERE dag rijdt dan zijn
-- prijspartner (of waarvan een datum ontbreekt), en die de €70 NIET in zijn
-- Tarief heeft — met de oorzaak per rit.
--
-- De partner wordt bepaald zoals de Pricing Engine het doet (pricingPartnerOf):
--   1. de andere rit van hetzelfde document (één DELIVERY + één COLLECTION);
--   2. anders: de andere rit van een groep met precies twee actieve ritten.
-- CANCELLED en DELETED ritten tellen niet mee.
WITH member AS (
  SELECT id, trip_group_id, pdf_document_id, direction
  FROM trip
  WHERE trip_group_id IS NOT NULL
    AND status IN ('OPEN', 'CLOSED')
),
same_document AS (
  SELECT a.id AS trip_id, b.id AS partner_id
  FROM member a
  JOIN member b
    ON b.trip_group_id = a.trip_group_id
   AND b.pdf_document_id = a.pdf_document_id
   AND b.id <> a.id
  WHERE a.pdf_document_id IS NOT NULL
    AND a.direction IN ('DELIVERY', 'COLLECTION')
    AND b.direction IN ('DELIVERY', 'COLLECTION')
    AND a.direction <> b.direction
    AND (
      SELECT count(*) FROM member c
      WHERE c.trip_group_id = a.trip_group_id
        AND c.pdf_document_id = a.pdf_document_id
    ) = 2
),
two_trip_group AS (
  SELECT a.id AS trip_id, b.id AS partner_id
  FROM member a
  JOIN member b ON b.trip_group_id = a.trip_group_id AND b.id <> a.id
  WHERE (SELECT count(*) FROM member c WHERE c.trip_group_id = a.trip_group_id) = 2
),
pair AS (
  SELECT trip_id, partner_id FROM same_document
  UNION ALL
  SELECT g.trip_id, g.partner_id FROM two_trip_group g
  WHERE NOT EXISTS (SELECT 1 FROM same_document s WHERE s.trip_id = g.trip_id)
),
checked AS (
  SELECT
    t.id                         AS trip_id,
    t.booking_number,
    t.container_number,
    t.planning_date              AS datum,
    partner.booking_number       AS partner_booking,
    partner.planning_date        AS partner_datum,
    partner.status               AS partner_status,
    tp.calculated_at             AS berekend_op,
    tp.combination_match,
    tp.route_selection,
    EXISTS (
      SELECT 1 FROM trip_pricing_item item
      WHERE item.trip_pricing_id = tp.id AND item.description = 'Over ST toeslag'
    ) AS heeft_70
  FROM pair
  JOIN trip t       ON t.id = pair.trip_id AND t.status = 'CLOSED'
  JOIN trip partner ON partner.id = pair.partner_id
  LEFT JOIN trip_pricing tp ON tp.trip_id = t.id
  WHERE t.planning_date > partner.planning_date
     OR t.planning_date IS NULL
     OR partner.planning_date IS NULL
)
SELECT
  CASE
    WHEN datum IS NULL OR partner_datum IS NULL
      THEN '1. DATUM ONTBREEKT — vul de planningsdatum van beide ritten in'
    WHEN berekend_op IS NULL
      THEN '2. NOOIT BEREKEND — sluit de rit of herbereken'
    WHEN combination_match IS DISTINCT FROM 'MATCHED' AND route_selection <> 'MANUAL'
      THEN '3. GEEN COMBINATIE HERKEND (' || coalesce(combination_match::text, 'geen') || ') — geen route, dus geen €70'
    ELSE '4. OUDE PRIJSBEREKENING — herberekenen (Prijs herberekenen)'
  END AS oorzaak,
  booking_number, container_number, datum,
  partner_booking, partner_datum, partner_status,
  berekend_op, combination_match, route_selection, trip_id
FROM checked
WHERE NOT heeft_70
ORDER BY oorzaak, datum, booking_number;
