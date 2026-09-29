"use client";

import { useState } from "react";

import { userFacingMessage } from "@/lib/api/client";
import {
  applyInvoiceAudit,
  type AppliedInvoiceAudit,
  type InvoiceAuditResult,
} from "@/lib/api/invoice-audit";
import { downloadBlob } from "@/lib/download";
import { useTranslation } from "@/lib/i18n/language-provider";

/**
 * The final step: process the invoice and save the corrected document.
 *
 * ── WHY IT IS A SEPARATE ACTION ─────────────────────────────────────────────
 * Checking a file changes nothing and may be done as often as an operator
 * likes. THIS is the one that corrects the document, adds what the invoice
 * forgot and marks the transports paid — so it is never what an upload does by
 * itself. It is offered once the check has been read, and it says plainly what
 * it will do before it is pressed.
 *
 * ── ONE REQUEST, ONE OUTCOME ────────────────────────────────────────────────
 * The button is disabled while the request is in flight, so a second click
 * cannot start a second processing of the same week. What comes back is the
 * file, which is saved immediately, and the counts the run reported.
 */
export function InvoiceApply({
  file,
  result,
  applied,
  onApplied,
}: {
  file: File;
  result: InvoiceAuditResult;
  applied: AppliedInvoiceAudit | null;
  onApplied: (applied: AppliedInvoiceAudit) => void;
}) {
  const t = useTranslation();
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply(): Promise<void> {
    if (isApplying) {
      return;
    }

    setIsApplying(true);
    setError(null);

    try {
      const outcome = await applyInvoiceAudit(file);

      // The file first: it is what the operator came for, and it exists only
      // because the server managed to produce it.
      downloadBlob(outcome.file, outcome.fileName);
      onApplied(outcome);
    } catch (failure: unknown) {
      setError(userFacingMessage(failure));
    } finally {
      setIsApplying(false);
    }
  }

  return (
    <div className="border-t border-border px-5 py-4">
      {applied ? (
        <AppliedResult applied={applied} result={result} />
      ) : (
        <>
          <p className="text-sm text-secondary">
            {t("invoiceAudit.apply.description")}
          </p>
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={() => void apply()}
              disabled={isApplying}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isApplying
                ? t("invoiceAudit.apply.working")
                : t("invoiceAudit.apply.action")}
            </button>
            <span className="text-xs text-muted">
              {t("invoiceAudit.apply.willPay")} {payableCount(result)}
            </span>
          </div>
        </>
      )}

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-foreground"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** What the run actually did, in the operator's own numbers. */
function AppliedResult({
  applied,
  result,
}: {
  applied: AppliedInvoiceAudit;
  result: InvoiceAuditResult;
}) {
  const t = useTranslation();

  const lines: readonly { label: string; value: number | string }[] = [
    { label: t("invoiceAudit.applied.rows"), value: result.summary.totalRows },
    {
      label: t("invoiceAudit.applied.checked"),
      value: result.summary.priceChecked,
    },
    {
      label: t("invoiceAudit.applied.corrected"),
      value: applied.correctedCells,
    },
    { label: t("invoiceAudit.applied.problems"), value: applied.rowsMarked },
    { label: t("invoiceAudit.applied.added"), value: applied.rowsAdded },
    { label: t("invoiceAudit.applied.paid"), value: applied.paidTrips },
    {
      label: t("invoiceAudit.applied.alreadyPaid"),
      value: applied.alreadyPaid,
    },
  ];

  return (
    <div role="status">
      <p className="text-sm font-semibold text-success">
        {t("invoiceAudit.applied.title")}
      </p>
      <p className="mt-1 text-xs text-muted">
        {t("invoiceAudit.applied.downloaded")} {applied.fileName}
      </p>

      <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-sm">
        {lines.map((line) => (
          <div key={line.label}>
            <dt className="text-xs uppercase tracking-wide text-muted">
              {line.label}
            </dt>
            <dd className="font-medium tabular-nums text-foreground">
              {line.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * How many transports this will settle, read from the check.
 *
 * The same rule the backend applies: a line matched to one CLOSED Trip whose
 * pricing was reconciled. It is shown BEFORE the button is pressed, because an
 * operator should know what a final action is about to do.
 */
function payableCount(result: InvoiceAuditResult): number {
  const payable = new Set(
    result.rows
      .filter(
        (row) =>
          row.status === "MATCHED" &&
          row.trip !== null &&
          (row.pricingStatus === "MATCHED_NO_CHANGES" ||
            row.pricingStatus === "PRICING_CORRECTED"),
      )
      .map((row) => row.trip!.id),
  );

  return payable.size;
}
