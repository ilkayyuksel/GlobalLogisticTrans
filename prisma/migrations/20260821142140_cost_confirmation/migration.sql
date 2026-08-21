-- AlterEnum
ALTER TYPE "import_type" ADD VALUE 'COST_CONFIRMATION';

-- CreateTable
CREATE TABLE "cost_confirmation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "trip_id" UUID NOT NULL,
    "pdf_document_id" UUID NOT NULL,
    "cc_number" TEXT NOT NULL,
    "cost_code" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'EUR',
    "received_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_confirmation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cost_confirmation_trip_id_idx" ON "cost_confirmation"("trip_id");

-- CreateIndex
CREATE INDEX "cost_confirmation_pdf_document_id_idx" ON "cost_confirmation"("pdf_document_id");

-- CreateIndex
CREATE UNIQUE INDEX "cost_confirmation_trip_id_cc_number_key" ON "cost_confirmation"("trip_id", "cc_number");

-- AddForeignKey
ALTER TABLE "cost_confirmation" ADD CONSTRAINT "cost_confirmation_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_confirmation" ADD CONSTRAINT "cost_confirmation_pdf_document_id_fkey" FOREIGN KEY ("pdf_document_id") REFERENCES "pdf_document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
