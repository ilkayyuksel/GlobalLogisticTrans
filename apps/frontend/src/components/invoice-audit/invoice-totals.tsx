"use client";

import type { InvoiceAuditResult } from "@/lib/api/invoice-audit";
import { useTranslation } from "@/lib/i18n/language-provider";

/**
 * The invoice's amounts before and after the correction, as the backend added
 * them up over the lines of the document and of the corrected copy. Only the
 * columns that change are listed, beside the grand total.
 */
export function InvoiceTotals({ result }: { result: InvoiceAuditResult }) {
  const t = useTranslation();
  const { totals } = result;
  const changed = totals.columns.filter((column) => column.before !== column.after);

  return (
    <div className="border-t border-border px-5 py-4 text-sm">
      <h3 className="font-semibold text-foreground">{t("invoiceAudit.totals.title")}</h3>
      <table className="mt-2 text-left tabular-nums">
        <thead className="text-xs uppercase tracking-wide text-muted">
          <tr>
            <th scope="col" className="pr-6 font-medium" />
            <th scope="col" className="pr-6 font-medium">{t("invoiceAudit.totals.before")}</th>
            <th scope="col" className="font-medium">{t("invoiceAudit.totals.after")}</th>
          </tr>
        </thead>
        <tbody>
          {changed.map((column) => (
            <tr key={column.column}>
              <th scope="row" className="pr-6 font-normal text-secondary">{column.column}</th>
              <td className="pr-6 text-secondary">€{column.before}</td>
              <td className="text-foreground">€{column.after}</td>
            </tr>
          ))}
          <tr className="font-medium">
            <th scope="row" className="pr-6 text-foreground">{t("invoiceAudit.totals.total")}</th>
            <td className="pr-6 text-secondary">€{totals.before}</td>
            <td className="text-foreground">€{totals.after}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
