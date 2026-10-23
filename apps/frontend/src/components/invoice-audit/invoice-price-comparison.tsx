"use client";

import type { InvoicePriceComparison } from "@/lib/api/invoice-audit";
import { useTranslation } from "@/lib/i18n/language-provider";

/**
 * One line's prices, Excel beside Trano, one component per row: what the
 * invoice states, what Trano holds, and what the corrected document writes.
 *
 * Laid out, never decided: every figure and every outcome is the backend's
 * comparison (`comparisons`), so the screen cannot show a correction the file
 * will not carry. A written value is red, as it will be in the Excel; a figure
 * the check could not judge is in the warning colour.
 */
export function InvoicePriceComparisonTable({ comparisons }: { comparisons: readonly InvoicePriceComparison[] }) {
  const t = useTranslation();

  return (
    <table className="text-xs tabular-nums">
      <thead className="text-muted">
        <tr>
          <th scope="col" className="pr-3 text-left font-normal">
            {t("invoiceAudit.pricing.compare.component")}
          </th>
          <th scope="col" className="pr-3 text-right font-normal">
            {t("invoiceAudit.pricing.compare.excel")}
          </th>
          <th scope="col" className="pr-3 text-right font-normal">
            {t("invoiceAudit.pricing.compare.trano")}
          </th>
          <th scope="col" className="text-left font-normal">
            {t("invoiceAudit.pricing.compare.result")}
          </th>
        </tr>
      </thead>
      <tbody>
        {comparisons.map((comparison) => (
          <tr key={comparison.component}>
            <th scope="row" className="pr-3 text-left font-normal text-muted">
              {comparison.component}
            </th>
            <td className="pr-3 text-right text-secondary">
              {toMoney(comparison.excelValue)}
              {comparison.excelCellEmpty ? (
                <span className="ml-1 text-muted">({t("invoiceAudit.pricing.compare.empty")})</span>
              ) : null}
            </td>
            <td className="pr-3 text-right text-secondary">{toMoney(comparison.tranoValue)}</td>
            <td className="whitespace-nowrap">
              <Outcome comparison={comparison} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Outcome({ comparison }: { comparison: InvoicePriceComparison }) {
  const t = useTranslation();

  switch (comparison.outcome) {
    case "UNCHANGED":
      return <span className="text-success">{t("invoiceAudit.pricing.compare.unchanged")}</span>;
    case "RAISE":
      return (
        <span className="font-medium text-danger" title={t("invoiceAudit.pricing.compare.writtenHint")}>
          {t("invoiceAudit.pricing.compare.written")} {toMoney(comparison.writtenValue)}
        </span>
      );
    case "REMOVE":
      return (
        <span className="font-medium text-danger" title={t("invoiceAudit.pricing.compare.writtenHint")}>
          {t("invoiceAudit.pricing.removed")}
        </span>
      );
    case "KEEP_AMOUNT":
      return (
        <span className="text-secondary">
          {toMoney(comparison.writtenValue)} · {t("invoiceAudit.pricing.keptAmount")}
        </span>
      );
    case "INVOICE_HIGHER":
      return <span className="text-secondary">{t("invoiceAudit.pricing.notLowered")}</span>;
    case "NOT_PLACEABLE":
      return <span className="text-warning">{t("invoiceAudit.pricing.notPlaced")}</span>;
    case "UNREADABLE":
      return <span className="text-warning">{t("invoiceAudit.pricing.unreadable")}</span>;
  }
}

/** The backend's money string as the invoice check shows money; nothing is parsed or rounded. */
function toMoney(amount: string | null): string {
  return amount === null ? "—" : `€${amount}`;
}
