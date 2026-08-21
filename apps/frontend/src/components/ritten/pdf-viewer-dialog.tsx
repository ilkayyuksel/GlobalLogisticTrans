"use client";

import { useCallback, useEffect, useState } from "react";

import { LoadingState } from "@/components/ui/states";
import { useAsync } from "@/hooks/use-async";
import { userFacingMessage } from "@/lib/api/client";
import { fetchPdfDocument } from "@/lib/api/pdf-documents";
import type { Trip } from "@/lib/api/types";
import { downloadBlob } from "@/lib/download";
import { useTranslation } from "@/lib/i18n/language-provider";
import { RittenDialog } from "./ritten-dialog";

/**
 * The source transport order, as it was imported.
 *
 * The bytes are fetched ONCE and shown through the browser's own PDF viewer:
 * nothing is parsed here, nothing is re-uploaded, and no copy is kept. The same
 * fetched blob serves the download, so choosing to save it costs no second
 * request.
 *
 * Fetching rather than pointing an iframe straight at the URL is deliberate: a
 * failure is then a message an operator can read — "this document's file is
 * missing from storage" — instead of an error envelope rendered inside a viewer
 * frame.
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
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
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

  useEffect(() => {
    if (!document.data) {
      return;
    }

    const url = URL.createObjectURL(document.data);
    setObjectUrl(url);

    // Released when the dialog closes or the document changes; a leaked object
    // URL holds the whole file in memory for the life of the page.
    return () => {
      URL.revokeObjectURL(url);
      setObjectUrl(null);
    };
  }, [document.data]);

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

        {objectUrl ? (
          <>
            <iframe
              src={objectUrl}
              title={t("ritten.pdf.viewerLabel")}
              className="h-[70vh] w-full rounded-md border border-border bg-card"
            />

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
