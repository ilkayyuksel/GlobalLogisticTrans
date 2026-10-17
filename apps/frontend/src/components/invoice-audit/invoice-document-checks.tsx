"use client";

import type { InvoiceAuditResult } from "@/lib/api/invoice-audit";
import { useTranslation } from "@/lib/i18n/language-provider";

/**
 * What the check concluded about the document as a whole, beside its lines.
 *
 *   totals that deviate   the backend adds no line to such a document, because
 *                         a total that stops short would leave the line out; the
 *                         deviations are listed exactly as it found them
 *   the Fuel header       rewritten only when the whole column states one new
 *                         percentage; shown as the text before and after
 */
export function InvoiceDocumentChecks({ result }: { result: InvoiceAuditResult }) {
  const t = useTranslation();
  const { totalsStructure, fuelHeader } = result;

  if (totalsStructure.sound && fuelHeader === null) {
    return null;
  }

  return (
    <div className="space-y-2 border-t border-border px-5 py-4 text-sm">
      {totalsStructure.sound ? null : (
        <div>
          <h3 className="font-semibold text-warning">
            {t("invoiceAudit.document.totalsDeviate")}
          </h3>
          <p className="mt-1 text-xs text-muted">
            {t("invoiceAudit.document.totalsDeviateDescription")}
          </p>
          <ul className="mt-1 list-disc pl-5 text-xs text-secondary">
            {totalsStructure.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}
      {fuelHeader ? (
        <p className="text-xs text-secondary">
          <span className="font-medium text-foreground">
            {t("invoiceAudit.document.fuelHeader")}
          </span>{" "}
          {[fuelHeader.header, ...(fuelHeader.label ? [fuelHeader.label] : [])]
            .map((change) => `${change.address}: “${change.before.trim()}” → “${change.after.trim()}”`)
            .join(" · ")}
        </p>
      ) : null}
    </div>
  );
}
