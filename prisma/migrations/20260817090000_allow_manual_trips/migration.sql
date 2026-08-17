-- Manual Trips: a Trip may exist without a PDF and without planning data.
--
-- A Trip used to be, by construction, the product of a parsed transport order:
-- it needed a source document, a booking number, a container type, a
-- destination and two dates. That is true of an imported Trip and false of one
-- an administrator enters by hand — a phone call announcing a job whose details
-- follow later.
--
-- Exactly the seven columns that blocked such a Trip are relaxed. Nothing else
-- is touched: every other column keeps its constraint, and no CHECK, index or
-- foreign key is altered. In particular pdf_document_id remains a foreign key
-- with ON DELETE RESTRICT, so an imported Trip still cannot lose the document
-- that explains it — it may now simply have none from the start.
--
-- Reversible and non-destructive: dropping NOT NULL rewrites no rows and
-- discards no data. Existing Trips are unaffected, and every one of them still
-- carries values in all seven columns.

ALTER TABLE "trip" ALTER COLUMN "pdf_document_id" DROP NOT NULL;
ALTER TABLE "trip" ALTER COLUMN "booking_number" DROP NOT NULL;
ALTER TABLE "trip" ALTER COLUMN "container_type" DROP NOT NULL;
ALTER TABLE "trip" ALTER COLUMN "destination_city" DROP NOT NULL;
ALTER TABLE "trip" ALTER COLUMN "destination_country" DROP NOT NULL;
ALTER TABLE "trip" ALTER COLUMN "original_planning_date" DROP NOT NULL;
ALTER TABLE "trip" ALTER COLUMN "planning_date" DROP NOT NULL;
