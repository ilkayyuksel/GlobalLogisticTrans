"use client";

import { useCallback } from "react";

import { LoadingState } from "@/components/ui/states";
import { useAsync } from "@/hooks/use-async";
import { userFacingMessage } from "@/lib/api/client";
import { fetchPdfDocument } from "@/lib/api/pdf-documents";
import type { Trip } from "@/lib/api/types";
import { downloadBlob } from "@/lib/download";
import { useTranslation } from "@/lib/i18n/language-provider";
import { PdfPages } from "./pdf-pages";
import { RittenDialog } from "./ritten-dialog";

/**
 * A stored document — the source transport order, or any later one — as it was
 * imported.
 *
 * The bytes are fetched ONCE per opening and drawn by pdf.js (see `PdfPages`),
 * not handed to the browser's own PDF plugin: tablet browsers have none, and
 * the viewer used to stay empty there. The same fetched Blob serves the
 * download, so saving the file costs no second request. Nothing is parsed for
 * data, re-uploaded or kept after the dialog closes.
 *
 * Fetching rather than pointing a viewer straight at the URL is deliberate: a
 * failure is then a message an operator can read — "this document's file is
 * missing from storage" — instead of an error envelope rendered as a page.
 */
export function PdfViewerDialog({
  trip,
  pdfDocumentId,
  title,
  onClose,
}: {
  trip: Trip;
  /**
   * The document to show. Defaults to the Trip's original order, which is what
   * every caller wanted before a Trip could have more than one — the history
   * list passes the id of the UPDATE or CANCEL an operator picked.
   */
  pdfDocumentId?: string;
  /** What to call it. Defaults to the booking number. */
  title?: string;
  onClose: () => void;
}) {
  const t = useTranslation();
  // Only reachable for a Trip that has a document: the action that opens this
  // dialog is disabled otherwise.
  const documentId = pdfDocumentId ?? (trip.pdfDocumentId as string);

  const document = useAsync(
    useCallback(
      (signal: AbortSignal) => fetchPdfDocument(documentId, signal),
      [documentId],
    ),
    [documentId],
  );

  return (
    <RittenDialog
      title={`${t("ritten.pdf.title")} — ${title ?? trip.bookingNumber}`}
      onClose={onClose}
    >
      <div className="px-4 py-3">
        {document.isLoading ? (
          <LoadingState label={t("ritten.pdf.loading")} />
        ) : null}

        {!document.isLoading && document.error ? (
          <p
            role="alert"
            className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-foreground"
          >
            <span className="font-medium">{t("ritten.pdf.failed")}</span>{" "}
            {userFacingMessage(document.error)}
          </p>
        ) : null}

        {document.data ? (
          <>
            <PdfPages file={document.data} label={t("ritten.pdf.viewerLabel")} />

            <button
              type="button"
              onClick={() =>
                document.data &&
                downloadBlob(
                  document.data,
                  title ?? `${trip.bookingNumber}.pdf`,
                )
              }
              className="mt-3 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover"
            >
              {t("ritten.pdf.download")}
            </button>
          </>
        ) : null}
      </div>
    </RittenDialog>
  );
}
