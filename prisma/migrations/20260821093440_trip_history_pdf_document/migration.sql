-- AlterTable
ALTER TABLE "trip_history" ADD COLUMN     "pdf_document_id" UUID;

-- CreateIndex
CREATE INDEX "trip_history_pdf_document_id_idx" ON "trip_history"("pdf_document_id");

-- AddForeignKey
ALTER TABLE "trip_history" ADD CONSTRAINT "trip_history_pdf_document_id_fkey" FOREIGN KEY ("pdf_document_id") REFERENCES "pdf_document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
