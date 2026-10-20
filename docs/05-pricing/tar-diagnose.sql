-- TAR — diagnose (alleen lezen, wijzigt niets).
--
-- Twee vragen, elk een eigen query. Voer ze uit op een kopie of read-only
-- verbinding; ze schrijven niets. Herberekenen gebeurt daarna bewust, per rit,
-- via "Prijs herberekenen" in de Rittenlijst — nooit automatisch.


-- ── A. HISTORISCHE TAR-REGELS DIE NIET EENDUIDIG TE CLASSIFICEREN WAREN ─────
-- Regels opgeslagen VÓÓR migratie 20261020120000 (die `is_automatic` invoerde),
-- met één regel van de automatische property op de snapshot. Zie de migratie
-- voor de regel. Twee soorten:
--
--   NIET EENDUIDIG          geen toekenning nu, en de rit is niet afgewerkt of
--                           de snapshot is FAILED: een handmatige TAR kan later
--                           weggehaald zijn zonder herberekening. Als automatisch
--                           gemarkeerd.
--   AFGELEID UIT TIJDSTIP   de toekenning is NA de berekening aangemaakt, dus de
--                           regel was die toekenning niet: als automatisch
--                           gemarkeerd. Alleen fout als een eerdere toekenning
--                           verwijderd en opnieuw aangemaakt werd.
--
-- Oplossen: een afgewerkte rit herberekenen, een open rit afwerken. De nieuwe
-- snapshot markeert de Engine zelf; de regel verdwijnt dan uit deze lijst.
WITH migration AS (
  SELECT finished_at
  FROM _prisma_migrations
  WHERE migration_name = '20261020120000_trip_pricing_item_is_automatic'
    AND finished_at IS NOT NULL
),
automatic_property AS (
  SELECT value::uuid AS id
  FROM setting
  WHERE category = 'PRICING' AND key = 'AUTOMATIC_CUSTOM_PROPERTY_ID'
),
single_lines AS (
  SELECT item.id AS item_id, item.is_automatic, pricing.trip_id, pricing.calculated_at,
         pricing.calculation_status
  FROM trip_pricing_item item
  JOIN trip_pricing pricing ON pricing.id = item.trip_pricing_id
  JOIN automatic_property property ON property.id = item.custom_property_id
  CROSS JOIN migration
  WHERE item.created_at <= migration.finished_at
    AND (
      SELECT count(*) FROM trip_pricing_item other
      WHERE other.trip_pricing_id = item.trip_pricing_id
        AND other.custom_property_id = property.id
    ) = 1
)
SELECT
  CASE
    WHEN assignment.id IS NOT NULL THEN 'AFGELEID UIT TIJDSTIP'
    ELSE 'NIET EENDUIDIG'
  END AS classificatie,
  line.is_automatic AS gemarkeerd_als_automatisch,
  trip.booking_number,
  trip.status,
  trip.planning_date,
  line.calculated_at AS berekend_op,
  line.calculation_status,
  assignment.created_at AS toegekend_op,
  trip.id AS trip_id
FROM single_lines line
JOIN trip ON trip.id = line.trip_id
LEFT JOIN trip_custom_property assignment
  ON assignment.trip_id = line.trip_id
 AND assignment.custom_property_id = (SELECT id FROM automatic_property)
WHERE (assignment.id IS NOT NULL AND assignment.created_at > line.calculated_at)
   OR (assignment.id IS NULL AND (trip.status <> 'CLOSED' OR line.calculation_status = 'FAILED'))
ORDER BY classificatie, trip.planning_date, trip.booking_number;


-- ── B. AFGEWERKTE RITTEN DIE EEN AUTOMATISCHE TAR VERSCHULDIGD ZIJN EN WAARVAN
--       NIEMAND DE AANREKENING HEEFT ───────────────────────────────────────────
-- Een afgewerkte rit met een TAR-nummer, die geen COLLECTION-leg is van een
-- echte combinatie (één document, één DELIVERY en één COLLECTION), en waarvoor
-- op die dag geen enkele rit de automatische aanrekening van dat nummer heeft.
-- Herberekend krijgt de eerste van zo'n nummer/dag de TAR — `volgorde` 1 is die
-- rit wanneer ze in deze volgorde herberekend worden.
--
-- Benadering: de echte-combinatiecheck volgt `combinationLegOf` (één document,
-- één DELIVERY + één COLLECTION in dezelfde groep); een heropende houder telt
-- hier altijd mee, ook als een latere afgewerkte rit hem verving.
WITH owing AS (
  SELECT trip.id, trip.booking_number, trip.planning_date, trip.created_at,
         lower(btrim(trip.tar_nummer)) AS tar_key
  FROM trip
  WHERE trip.status = 'CLOSED'
    AND btrim(coalesce(trip.tar_nummer, '')) <> ''
    AND NOT (
      trip.direction = 'COLLECTION'
      AND trip.trip_group_id IS NOT NULL
      AND trip.pdf_document_id IS NOT NULL
      AND (
        SELECT count(*) FROM trip same_document
        WHERE same_document.trip_group_id = trip.trip_group_id
          AND same_document.pdf_document_id = trip.pdf_document_id
          AND same_document.status <> 'DELETED'
      ) = 2
      AND EXISTS (
        SELECT 1 FROM trip delivery
        WHERE delivery.trip_group_id = trip.trip_group_id
          AND delivery.pdf_document_id = trip.pdf_document_id
          AND delivery.direction = 'DELIVERY'
          AND delivery.status <> 'DELETED'
      )
    )
),
holders AS (
  SELECT DISTINCT lower(btrim(holder.tar_nummer)) AS tar_key, holder.planning_date, holder.id
  FROM trip_pricing_item item
  JOIN trip_pricing pricing ON pricing.id = item.trip_pricing_id
  JOIN trip holder ON holder.id = pricing.trip_id
  WHERE item.is_automatic
    AND pricing.calculation_status <> 'FAILED'
    AND holder.status NOT IN ('CANCELLED', 'DELETED')
)
SELECT
  row_number() OVER (PARTITION BY owing.tar_key, owing.planning_date ORDER BY owing.created_at, owing.id) AS volgorde,
  owing.booking_number,
  owing.planning_date,
  owing.tar_key AS tar_nummer,
  owing.id AS trip_id
FROM owing
WHERE NOT EXISTS (SELECT 1 FROM holders WHERE holders.id = owing.id)
  AND (
    owing.planning_date IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM holders
      WHERE holders.tar_key = owing.tar_key AND holders.planning_date = owing.planning_date
    )
  )
ORDER BY owing.planning_date, owing.tar_key, volgorde;
