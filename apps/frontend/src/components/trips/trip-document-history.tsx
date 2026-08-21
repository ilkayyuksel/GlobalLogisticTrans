"use client";

import { useCallback } from "react";

import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useAsync } from "@/hooks/use-async";
import { listTripDocuments } from "@/lib/api/trips";
import type { TripDocument } from "@/lib/api/types";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { TranslationKey } from "@/lib/i18n/translations";

/**
 * Every transport document that concerns this Trip.
 *
 * ── DELIBERATELY SMALL ──────────────────────────────────────────────────────
 * A list, not a document-management module. It answers the two questions an
 * operator actually asks — "which documents did we get, and in what order?" and
 * "let me see that one" — and it reuses the PDF viewer and download the rest of
 * the product already uses. No second content route, no storage path, no email.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * One request. The change set of an UPDATE comes with the list, so telling one
 * update from another needs no further call.
 */

const ACTION_LABEL_KEYS: Record<TripDocument["action"], TranslationKey> = {
  NEW: "tripDocuments.action.new",
  UPDATE: "tripDocuments.action.update",
  CANCEL: "tripDocuments.action.cancel",
  COST_CONFIRMATION: "tripDocuments.action.costConfirmation",
};

const FIELD_LABEL_KEYS: Record<string, TranslationKey> = {
  containerNumber: "ritten.column.container",
  containerType: "ritten.column.containerType",
  terminal: "ritten.column.terminal",
  destinationCity: "ritten.column.address",
  destinationCountry: "ritten.column.address",
  originalPlanningDate: "ritten.column.date",
  startTime: "ritten.column.start",
  endTime: "ritten.column.end",
  direction: "ritten.column.direction",
};

export function TripDocumentHistory({
  tripId,
  onView,
  onDownload,
}: {
  tripId: string;
  onView: (pdfDocumentId: string) => void;
  onDownload: (document: TripDocument) => void;
}) {
  const t = useTranslation();

  const documents = useAsync(
    useCallback(
      (signal: AbortSignal) => listTripDocuments(tripId, signal),
      [tripId],
    ),
    [tripId],
  );

  return (
    <Card>
      <CardHeader title={t("tripDocuments.title")} />

      {documents.isLoading ? <LoadingState /> : null}

      {!documents.isLoading && documents.error ? (
        <ErrorState error={documents.error} onRetry={documents.reload} />
      ) : null}

      {!documents.isLoading && !documents.error && documents.data?.length === 0 ? (
        <EmptyState title={t("tripDocuments.empty")} />
      ) : null}

      {!documents.isLoading && !documents.error && documents.data?.length ? (
        <ul className="divide-y divide-border">
          {documents.data.map((document) => (
            <DocumentRow
              key={`${document.pdfDocumentId}-${document.occurredAt}`}
              document={document}
              onView={() => onView(document.pdfDocumentId)}
              onDownload={() => onDownload(document)}
            />
          ))}
        </ul>
      ) : null}

      <CardBody>
        <p className="text-[11px] text-muted">{t("tripDocuments.note")}</p>
      </CardBody>
    </Card>
  );
}

function DocumentRow({
  document,
  onView,
  onDownload,
}: {
  document: TripDocument;
  onView: () => void;
  onDownload: () => void;
}) {
  const t = useTranslation();

  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2">
          <Badge tone={badgeToneFor(document.action)}>
            {t(ACTION_LABEL_KEYS[document.action])}
          </Badge>
          <span className="text-sm font-medium text-foreground">
            {document.originalFilename}
          </span>
          {/*
            An UPDATE that created the Trip is not a revision of anything, and
            saying so here is what keeps it from reading like one.
          */}
          {document.createdTrip && document.action === "UPDATE" ? (
            <Badge tone="info">{t("tripDocuments.createdTrip")}</Badge>
          ) : null}
          {/* An arrival that changed nothing is said plainly, not left blank. */}
          {document.applied ? null : (
            <Badge tone="neutral">{t("tripDocuments.notApplied")}</Badge>
          )}
        </span>

        <span className="flex items-center gap-3">
          <button
            type="button"
            onClick={onView}
            className="text-sm font-medium text-primary hover:underline"
          >
            {t("tripDocuments.view")}
          </button>
          <button
            type="button"
            onClick={onDownload}
            className="text-sm font-medium text-primary hover:underline"
          >
            {t("tripDocuments.download")}
          </button>
        </span>
      </div>

      <p className="mt-0.5 text-xs text-secondary">
        <time dateTime={document.occurredAt}>
          {new Date(document.occurredAt).toLocaleString()}
        </time>
      </p>

      {document.changedFields.length > 0 ? (
        <p className="mt-1 text-xs text-secondary">
          {t("tripDocuments.changed")}{" "}
          <ChangedFields fields={document.changedFields} />
        </p>
      ) : null}

      {document.action === "UPDATE" && document.changedFields.length === 0 ? (
        <p className="mt-1 text-xs text-muted">
          {t("tripDocuments.changedNothing")}
        </p>
      ) : null}
    </li>
  );
}

/**
 * A cancellation reads as a warning; a confirmed cost reads as good news; an
 * order or an update is neutral information.
 */
function badgeToneFor(action: TripDocument["action"]) {
  if (action === "CANCEL") {
    return "danger" as const;
  }

  return action === "COST_CONFIRMATION"
    ? ("success" as const)
    : ("info" as const);
}

/** The fields this document moved, named the way the columns name them. */
function ChangedFields({ fields }: { fields: readonly string[] }) {
  const t = useTranslation();

  // Two spellings of one place — city and country — read as one field.
  const labels = [
    ...new Set(
      fields.map((field) =>
        FIELD_LABEL_KEYS[field] ? t(FIELD_LABEL_KEYS[field]) : field,
      ),
    ),
  ];

  return (
    <span className="font-medium text-foreground">{labels.join(", ")}</span>
  );
}
