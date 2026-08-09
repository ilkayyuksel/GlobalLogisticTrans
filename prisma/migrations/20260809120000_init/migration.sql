-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "trip_status" AS ENUM ('OPEN', 'CLOSED', 'CANCELLED', 'DELETED');

-- CreateEnum
CREATE TYPE "maintenance_status" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "import_type" AS ENUM ('NEW', 'UPDATE', 'CANCEL');

-- CreateEnum
CREATE TYPE "parser_result" AS ENUM ('SUCCESS', 'WARNING', 'FAILED', 'PARTIAL_SUCCESS');

-- CreateEnum
CREATE TYPE "pricing_calculation_status" AS ENUM ('CALCULATED', 'FAILED', 'MANUAL_OVERRIDE');

-- CreateEnum
CREATE TYPE "email_processing_status" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED');

-- CreateEnum
CREATE TYPE "import_source" AS ENUM ('EMAIL', 'MANUAL_UPLOAD', 'API');

-- CreateEnum
CREATE TYPE "setting_value_type" AS ENUM ('STRING', 'INTEGER', 'DECIMAL', 'BOOLEAN', 'DATE', 'JSON');

-- CreateTable
CREATE TABLE "imported_email" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sender_email" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL,
    "processed_at" TIMESTAMPTZ(6),
    "processing_status" "email_processing_status" NOT NULL DEFAULT 'RECEIVED',
    "import_type" "import_type" NOT NULL,
    "body" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "imported_email_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pdf_document" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "imported_email_id" UUID,
    "import_source" "import_source" NOT NULL,
    "original_filename" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "file_size_bytes" BIGINT NOT NULL,
    "file_hash" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "parser_version" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pdf_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parser_run" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "pdf_document_id" UUID NOT NULL,
    "parser_version" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "finished_at" TIMESTAMPTZ(6),
    "duration_ms" INTEGER,
    "result" "parser_result" NOT NULL,
    "warning_count" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "error_code" TEXT,
    "error_message" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parser_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_group" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "pdf_document_id" UUID NOT NULL,
    "trip_group_id" UUID,
    "vehicle_id" UUID,
    "driver_id" UUID,
    "status" "trip_status" NOT NULL DEFAULT 'OPEN',
    "booking_number" TEXT NOT NULL,
    "container_number" TEXT,
    "container_type" TEXT NOT NULL,
    "terminal" TEXT,
    "destination_city" TEXT NOT NULL,
    "destination_country" TEXT NOT NULL,
    "original_planning_date" DATE NOT NULL,
    "planning_date" DATE NOT NULL,
    "start_time" TIME(6),
    "end_time" TIME(6),
    "execution_datetime" TIMESTAMPTZ(6),
    "waiting_time_minutes" INTEGER,
    "distance_km" DECIMAL(8,2),
    "internal_notes" TEXT,
    "parser_metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "trip_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "performed_by" VARCHAR(255) NOT NULL,
    "previous_value" JSONB,
    "new_value" JSONB,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_custom_property" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "trip_id" UUID NOT NULL,
    "custom_property_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_custom_property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "phone_number" TEXT,
    "email" TEXT,
    "emergency_contact" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vacation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "driver_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "reason" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vacation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "license_plate" TEXT NOT NULL,
    "display_color" TEXT NOT NULL,
    "description" TEXT,
    "brand" TEXT,
    "model" TEXT,
    "year" INTEGER,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trailer" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "license_plate" TEXT NOT NULL,
    "description" TEXT,
    "brand" TEXT,
    "model" TEXT,
    "year" INTEGER,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trailer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_assignment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vehicle_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vehicle_id" UUID,
    "trailer_id" UUID,
    "status" "maintenance_status" NOT NULL,
    "maintenance_date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "cost" DECIMAL(12,2),
    "workshop" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_property" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "default_price" DECIMAL(12,2),
    "display_order" INTEGER NOT NULL,
    "color" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custom_property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "setting" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "category" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "value_type" "setting_value_type" NOT NULL,
    "description" TEXT NOT NULL,
    "default_value" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_pricing" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "route_name" TEXT NOT NULL,
    "departure" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "base_price" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "route_pricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_component" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "display_order" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_component_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_pricing" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "trip_id" UUID NOT NULL,
    "total_price" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
    "calculated_at" TIMESTAMPTZ(6) NOT NULL,
    "pricing_engine_version" TEXT NOT NULL,
    "pricing_rule_version" TEXT NOT NULL,
    "calculation_status" "pricing_calculation_status" NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_pricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_pricing_item" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "trip_pricing_id" UUID NOT NULL,
    "pricing_component_id" UUID NOT NULL,
    "custom_property_id" UUID,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'EUR',
    "calculation_order" INTEGER NOT NULL,
    "quantity" DECIMAL(12,2),
    "unit_price" DECIMAL(12,2),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_pricing_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_event" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "description" TEXT,
    "event_type" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "start_time" TIME(6) NOT NULL,
    "end_date" DATE,
    "end_time" TIME(6),
    "color" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendar_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "note" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "color" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "note_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "imported_email_message_id_key" ON "imported_email"("message_id");

-- CreateIndex
CREATE INDEX "imported_email_processing_status_idx" ON "imported_email"("processing_status");

-- CreateIndex
CREATE INDEX "imported_email_received_at_idx" ON "imported_email"("received_at");

-- CreateIndex
CREATE UNIQUE INDEX "pdf_document_imported_email_id_key" ON "pdf_document"("imported_email_id");

-- CreateIndex
CREATE INDEX "pdf_document_file_hash_idx" ON "pdf_document"("file_hash");

-- CreateIndex
CREATE INDEX "pdf_document_import_source_idx" ON "pdf_document"("import_source");

-- CreateIndex
CREATE INDEX "pdf_document_uploaded_at_idx" ON "pdf_document"("uploaded_at");

-- CreateIndex
CREATE INDEX "parser_run_pdf_document_id_idx" ON "parser_run"("pdf_document_id");

-- CreateIndex
CREATE INDEX "parser_run_pdf_document_id_started_at_idx" ON "parser_run"("pdf_document_id", "started_at");

-- CreateIndex
CREATE INDEX "parser_run_result_idx" ON "parser_run"("result");

-- CreateIndex
CREATE INDEX "trip_booking_number_idx" ON "trip"("booking_number");

-- CreateIndex
CREATE INDEX "trip_planning_date_idx" ON "trip"("planning_date");

-- CreateIndex
CREATE INDEX "trip_status_idx" ON "trip"("status");

-- CreateIndex
CREATE INDEX "trip_status_planning_date_idx" ON "trip"("status", "planning_date");

-- CreateIndex
CREATE INDEX "trip_vehicle_id_planning_date_idx" ON "trip"("vehicle_id", "planning_date");

-- CreateIndex
CREATE INDEX "trip_trip_group_id_idx" ON "trip"("trip_group_id");

-- CreateIndex
CREATE INDEX "trip_driver_id_idx" ON "trip"("driver_id");

-- CreateIndex
CREATE INDEX "trip_pdf_document_id_idx" ON "trip"("pdf_document_id");

-- CreateIndex
CREATE INDEX "trip_history_trip_id_occurred_at_idx" ON "trip_history"("trip_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "trip_history_event_type_idx" ON "trip_history"("event_type");

-- CreateIndex
CREATE INDEX "trip_history_performed_by_idx" ON "trip_history"("performed_by");

-- CreateIndex
CREATE INDEX "trip_custom_property_custom_property_id_idx" ON "trip_custom_property"("custom_property_id");

-- CreateIndex
CREATE UNIQUE INDEX "trip_custom_property_trip_id_custom_property_id_key" ON "trip_custom_property"("trip_id", "custom_property_id");

-- CreateIndex
CREATE INDEX "driver_is_active_idx" ON "driver"("is_active");

-- CreateIndex
CREATE INDEX "vacation_driver_id_start_date_idx" ON "vacation"("driver_id", "start_date");

-- CreateIndex
CREATE INDEX "vacation_start_date_end_date_idx" ON "vacation"("start_date", "end_date");

-- CreateIndex
CREATE INDEX "vehicle_is_active_idx" ON "vehicle"("is_active");

-- CreateIndex
CREATE INDEX "trailer_is_active_idx" ON "trailer"("is_active");

-- CreateIndex
CREATE INDEX "vehicle_assignment_vehicle_id_valid_from_idx" ON "vehicle_assignment"("vehicle_id", "valid_from");

-- CreateIndex
CREATE INDEX "vehicle_assignment_driver_id_idx" ON "vehicle_assignment"("driver_id");

-- CreateIndex
CREATE INDEX "maintenance_vehicle_id_maintenance_date_idx" ON "maintenance"("vehicle_id", "maintenance_date");

-- CreateIndex
CREATE INDEX "maintenance_trailer_id_maintenance_date_idx" ON "maintenance"("trailer_id", "maintenance_date");

-- CreateIndex
CREATE INDEX "maintenance_status_idx" ON "maintenance"("status");

-- CreateIndex
CREATE INDEX "maintenance_maintenance_date_idx" ON "maintenance"("maintenance_date");

-- CreateIndex
CREATE INDEX "custom_property_is_active_display_order_idx" ON "custom_property"("is_active", "display_order");

-- CreateIndex
CREATE INDEX "setting_category_idx" ON "setting"("category");

-- CreateIndex
CREATE UNIQUE INDEX "setting_category_key_key" ON "setting"("category", "key");

-- CreateIndex
CREATE INDEX "route_pricing_is_active_idx" ON "route_pricing"("is_active");

-- CreateIndex
CREATE INDEX "pricing_component_is_active_display_order_idx" ON "pricing_component"("is_active", "display_order");

-- CreateIndex
CREATE UNIQUE INDEX "trip_pricing_trip_id_key" ON "trip_pricing"("trip_id");

-- CreateIndex
CREATE INDEX "trip_pricing_calculated_at_idx" ON "trip_pricing"("calculated_at");

-- CreateIndex
CREATE INDEX "trip_pricing_calculation_status_idx" ON "trip_pricing"("calculation_status");

-- CreateIndex
CREATE INDEX "trip_pricing_item_trip_pricing_id_calculation_order_idx" ON "trip_pricing_item"("trip_pricing_id", "calculation_order");

-- CreateIndex
CREATE INDEX "trip_pricing_item_pricing_component_id_idx" ON "trip_pricing_item"("pricing_component_id");

-- CreateIndex
CREATE INDEX "trip_pricing_item_custom_property_id_idx" ON "trip_pricing_item"("custom_property_id");

-- CreateIndex
CREATE INDEX "calendar_event_start_date_idx" ON "calendar_event"("start_date");

-- CreateIndex
CREATE INDEX "calendar_event_event_type_idx" ON "calendar_event"("event_type");

-- CreateIndex
CREATE INDEX "note_updated_at_idx" ON "note"("updated_at");

-- AddForeignKey
ALTER TABLE "pdf_document" ADD CONSTRAINT "pdf_document_imported_email_id_fkey" FOREIGN KEY ("imported_email_id") REFERENCES "imported_email"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parser_run" ADD CONSTRAINT "parser_run_pdf_document_id_fkey" FOREIGN KEY ("pdf_document_id") REFERENCES "pdf_document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip" ADD CONSTRAINT "trip_pdf_document_id_fkey" FOREIGN KEY ("pdf_document_id") REFERENCES "pdf_document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip" ADD CONSTRAINT "trip_trip_group_id_fkey" FOREIGN KEY ("trip_group_id") REFERENCES "trip_group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip" ADD CONSTRAINT "trip_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip" ADD CONSTRAINT "trip_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_history" ADD CONSTRAINT "trip_history_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_custom_property" ADD CONSTRAINT "trip_custom_property_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_custom_property" ADD CONSTRAINT "trip_custom_property_custom_property_id_fkey" FOREIGN KEY ("custom_property_id") REFERENCES "custom_property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacation" ADD CONSTRAINT "vacation_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_assignment" ADD CONSTRAINT "vehicle_assignment_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_assignment" ADD CONSTRAINT "vehicle_assignment_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance" ADD CONSTRAINT "maintenance_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance" ADD CONSTRAINT "maintenance_trailer_id_fkey" FOREIGN KEY ("trailer_id") REFERENCES "trailer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_pricing" ADD CONSTRAINT "trip_pricing_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_pricing_item" ADD CONSTRAINT "trip_pricing_item_trip_pricing_id_fkey" FOREIGN KEY ("trip_pricing_id") REFERENCES "trip_pricing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_pricing_item" ADD CONSTRAINT "trip_pricing_item_pricing_component_id_fkey" FOREIGN KEY ("pricing_component_id") REFERENCES "pricing_component"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_pricing_item" ADD CONSTRAINT "trip_pricing_item_custom_property_id_fkey" FOREIGN KEY ("custom_property_id") REFERENCES "custom_property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Constraints that Prisma's schema language cannot express.
--
-- Everything above this line was generated from prisma/schema.prisma.
-- Everything below is hand-written and MUST be preserved when this migration
-- is regenerated, otherwise the database silently becomes more permissive than
-- database_schema.md requires.
-- ---------------------------------------------------------------------------

-- Partial unique indexes (database_schema.md §1 "Active-Scoped Uniqueness").
--
-- Scoped to active rows on purpose: a licence plate, property name or component
-- code must become reusable once the owning record is deactivated. A plain
-- UNIQUE would reserve the value permanently and break that rule.

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_license_plate_active_key"
    ON "vehicle" ("license_plate") WHERE "is_active";

-- CreateIndex
CREATE UNIQUE INDEX "trailer_license_plate_active_key"
    ON "trailer" ("license_plate") WHERE "is_active";

-- CreateIndex
CREATE UNIQUE INDEX "custom_property_name_active_key"
    ON "custom_property" ("name") WHERE "is_active";

-- CreateIndex
CREATE UNIQUE INDEX "pricing_component_code_active_key"
    ON "pricing_component" ("code") WHERE "is_active";

-- CreateIndex
-- A route is currently defined as the departure/destination pair.
CREATE UNIQUE INDEX "route_pricing_departure_destination_active_key"
    ON "route_pricing" ("departure", "destination") WHERE "is_active";

-- CreateIndex
-- Guarantees a Vehicle has at most one open-ended (currently active) Driver
-- assignment, which is what makes Driver resolution for a Trip unambiguous.
CREATE UNIQUE INDEX "vehicle_assignment_active_vehicle_key"
    ON "vehicle_assignment" ("vehicle_id") WHERE "valid_to" IS NULL;

-- ---------------------------------------------------------------------------
-- CHECK constraints (database_schema.md, per-table "Constraints" sections).
--
-- The IS NULL branches are written out explicitly. A bare `col >= 0` would
-- already admit NULL, since NULL comparisons evaluate to unknown, but spelling
-- it out keeps the intent obvious to a future maintainer.
-- ---------------------------------------------------------------------------

-- AddCheckConstraint
ALTER TABLE "parser_run"
    ADD CONSTRAINT "parser_run_warning_count_check" CHECK ("warning_count" >= 0);

-- AddCheckConstraint
ALTER TABLE "parser_run"
    ADD CONSTRAINT "parser_run_error_count_check" CHECK ("error_count" >= 0);

-- AddCheckConstraint
ALTER TABLE "trip"
    ADD CONSTRAINT "trip_waiting_time_minutes_check"
    CHECK ("waiting_time_minutes" IS NULL OR "waiting_time_minutes" >= 0);

-- AddCheckConstraint
ALTER TABLE "trip"
    ADD CONSTRAINT "trip_distance_km_check"
    CHECK ("distance_km" IS NULL OR "distance_km" >= 0);

-- AddCheckConstraint
-- Both bounds are inclusive, so equal dates are a valid one-day vacation.
ALTER TABLE "vacation"
    ADD CONSTRAINT "vacation_date_range_check" CHECK ("end_date" >= "start_date");

-- AddCheckConstraint
ALTER TABLE "vehicle_assignment"
    ADD CONSTRAINT "vehicle_assignment_date_range_check"
    CHECK ("valid_to" IS NULL OR "valid_to" >= "valid_from");

-- AddCheckConstraint
-- A Maintenance record belongs to exactly one asset, never both and never
-- neither. The XOR over the two null-tests is what enforces "exactly one".
ALTER TABLE "maintenance"
    ADD CONSTRAINT "maintenance_single_asset_check"
    CHECK (("vehicle_id" IS NOT NULL) <> ("trailer_id" IS NOT NULL));

-- AddCheckConstraint
ALTER TABLE "maintenance"
    ADD CONSTRAINT "maintenance_cost_check" CHECK ("cost" IS NULL OR "cost" >= 0);

-- AddCheckConstraint
ALTER TABLE "route_pricing"
    ADD CONSTRAINT "route_pricing_base_price_check" CHECK ("base_price" >= 0);

-- AddCheckConstraint
-- pricing_rules.md: negative pricing is not supported for the total. Individual
-- items are deliberately unconstrained in sign (database_schema.md open point O6).
ALTER TABLE "trip_pricing"
    ADD CONSTRAINT "trip_pricing_total_price_check" CHECK ("total_price" >= 0);

-- AddCheckConstraint
ALTER TABLE "calendar_event"
    ADD CONSTRAINT "calendar_event_date_range_check"
    CHECK ("end_date" IS NULL OR "end_date" >= "start_date");
