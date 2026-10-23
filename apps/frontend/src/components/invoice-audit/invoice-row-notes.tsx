"use client";

import type {
  InvoiceAuditRow,
  InvoiceContainerCorrection,
} from "@/lib/api/invoice-audit";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { TranslationKey } from "@/lib/i18n/translations";

/** The answers a Combination can come to, and their colour. */
const COMBINATION_STYLE = {
  RECOGNISED: "border-success/40 bg-success/10 text-success",
  GEEN_COMBI: "border-primary/40 bg-primary/10 text-primary",
  REVIEW: "border-warning/40 bg-warning/10 text-warning",
} as const;

const NOTE = "inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-xs font-medium";

/**
 * What the backend decided about a line beyond its status: a corrected booking,
 * the confirmation an EC line charges, the Combination the Excel marks, and why
 * a line could not be resolved. Shown, never decided, here.
 */
export function InvoiceRowNotes({ row }: { row: InvoiceAuditRow }) {
  const t = useTranslation();
  const notes = [];

  if (row.bookingCorrection) {
    notes.push(
      <span
        key="booking"
        className={`${NOTE} border-warning/40 bg-warning/10 text-warning`}
        title={`${t("invoiceAudit.bookingCorrected.detail")} ${row.bookingCorrection.invoiceBookingNumber}`}
      >
        <span aria-hidden="true">⚠</span>
        {t("invoiceAudit.bookingCorrected")} → {row.bookingCorrection.tripBookingNumber}
      </span>,
    );
  }

  if (row.costConfirmation) {
    notes.push(
      <span key="cost" className="text-xs tabular-nums text-secondary">
        EC {row.costConfirmation.ccNumber} · €{row.costConfirmation.amount}
      </span>,
    );
  }

  if (row.combination) {
    notes.push(
      <span
        key="combination"
        className={`${NOTE} ${COMBINATION_STYLE[row.combination.verdict]}`}
        title={row.combination.reason ?? undefined}
      >
        {t(`invoiceAudit.combination.${row.combination.verdict}` as TranslationKey)}
        {row.combination.partnerRowNumber !== null
          ? ` · ${t("invoiceAudit.combination.partner")} ${row.combination.partnerRowNumber}`
          : null}
      </span>,
    );
  }

  if (row.remarks && row.remarks.added.length > 0) {
    notes.push(
      <span key="remarks" className="text-xs text-danger" title={row.remarks.after}>
        {t("invoiceAudit.remarks.added")} {row.remarks.added.join(",")}
      </span>,
    );
  }

  for (const [index, note] of (row.remarks?.notes ?? []).entries()) {
    notes.push(
      <span key={`remarks-note-${index}`} className="text-xs text-warning">
        {note}
      </span>,
    );
  }

  if (row.matchProblem) {
    notes.push(
      <span key="problem" className="text-xs text-warning">
        {row.matchProblem}
      </span>,
    );
  }

  return notes.length > 0 ? <div className="mt-1 flex flex-wrap gap-1">{notes}</div> : null;
}

/**
 * The transport was found; the container the invoice printed was not its own.
 *
 * One short line beside the container, in the warning colour the page already
 * uses for an unfinished Trip — no alert, no block of text. It says what the
 * corrected workbook will state instead; the hover text says it in full.
 */
export function ContainerCorrectionNote({
  correction,
}: {
  correction: InvoiceContainerCorrection;
}) {
  const t = useTranslation();

  return (
    <span
      className={`ml-2 ${NOTE} border-warning/40 bg-warning/10 text-warning`}
      title={`${t("invoiceAudit.containerCorrected.detail")} ${correction.invoiceContainerNumber} → ${correction.tripContainerNumber}`}
    >
      <span aria-hidden="true">⚠</span>
      {t("invoiceAudit.containerCorrected")} → {correction.tripContainerNumber}
    </span>
  );
}
