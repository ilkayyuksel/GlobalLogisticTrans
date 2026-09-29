"use client";

import type { InvoiceAuditResult } from "@/lib/api/invoice-audit";
import { useLanguage, useTranslation } from "@/lib/i18n/language-provider";
import { dayInMonthLabel } from "@/lib/ritten/date-labels";

/**
 * What the checked invoice came to.
 *
 * ── THE PERIOD IS READ, NOT ASSUMED ─────────────────────────────────────────
 * It comes from the Planning date values in the document, never from the file
 * name — a file called "week 13" may hold any days at all, and the days are
 * what the check actually judged. Showing it is what lets an operator see that
 * the right week was read.
 */
export function InvoiceAuditSummary({
  result,
}: {
  result: InvoiceAuditResult;
}) {
  const t = useTranslation();
  const { language } = useLanguage();

  const counts: readonly { label: string; value: number; tone: string }[] = [
    {
      label: t("invoiceAudit.summary.total"),
      value: result.summary.totalRows,
      tone: "text-foreground",
    },
    {
      label: t("invoiceAudit.summary.matched"),
      value: result.summary.matched,
      tone: "text-success",
    },
    {
      label: t("invoiceAudit.summary.notFound"),
      value: result.summary.notFound,
      tone: "text-danger",
    },
    {
      label: t("invoiceAudit.summary.notFinished"),
      value: result.summary.notFinished,
      tone: "text-warning",
    },
    {
      label: t("invoiceAudit.summary.ambiguous"),
      value: result.summary.ambiguous,
      tone: "text-danger",
    },
    {
      label: t("invoiceAudit.summary.priceUnchanged"),
      value: result.summary.priceUnchanged,
      tone: "text-success",
    },
    {
      label: t("invoiceAudit.summary.priceCorrected"),
      value: result.summary.priceCorrected,
      tone: "text-primary",
    },
    {
      label: t("invoiceAudit.summary.correctedCells"),
      value: result.summary.correctedCells,
      tone: "text-secondary",
    },
    {
      label: t("invoiceAudit.summary.missingTrips"),
      value: result.summary.missingTrips,
      tone: "text-primary",
    },
  ];

  return (
    <div className="border-b border-border px-5 py-4">
      <dl className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted">
            {t("invoiceAudit.summary.file")}
          </dt>
          <dd className="font-medium text-foreground">{result.fileName}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted">
            {t("invoiceAudit.summary.period")}
          </dt>
          <dd className="font-medium text-foreground">
            {result.period
              ? `${dayInMonthLabel(result.period.from, language)} - ${dayInMonthLabel(result.period.to, language)}`
              : "—"}
          </dd>
        </div>

        {counts.map((count) => (
          <div key={count.label}>
            <dt className="text-xs uppercase tracking-wide text-muted">
              {count.label}
            </dt>
            <dd className={`font-medium tabular-nums ${count.tone}`}>
              {count.value}
            </dd>
          </div>
        ))}
      </dl>

      {/*
        Rows that state something but not all three identity values. They were
        not checked against anything, so they are named rather than counted
        among the lines — a number an operator cannot locate is not useful.
      */}
      {result.incompleteRowNumbers.length > 0 ? (
        <p className="mt-3 text-xs text-warning">
          {t("invoiceAudit.summary.incomplete")}{" "}
          {result.incompleteRowNumbers.join(", ")}
        </p>
      ) : null}
    </div>
  );
}
