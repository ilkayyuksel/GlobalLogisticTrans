"use client";

import type { InvoiceAdviceSeverity, InvoiceRowAdvice } from "@/lib/api/invoice-audit";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { TranslationKey } from "@/lib/i18n/translations";

const SEVERITY_STYLE: Record<InvoiceAdviceSeverity, { readonly labelKey: TranslationKey; readonly badge: string }> = {
  INFO: { labelKey: "invoiceAudit.advice.INFO", badge: "border-primary/40 bg-primary/10 text-primary" },
  WARNING: { labelKey: "invoiceAudit.advice.WARNING", badge: "border-warning/40 bg-warning/10 text-warning" },
  ERROR: { labelKey: "invoiceAudit.advice.ERROR", badge: "border-danger/40 bg-danger/10 text-danger" },
};

/**
 * The recommended action for one line: per piece of advice, how serious it is,
 * what is wrong, what became of the line and what to do — each on its own
 * line, never glued together. Worded by the backend; only laid out here.
 */
export function InvoiceRowAdviceList({ advice }: { advice: readonly InvoiceRowAdvice[] }) {
  const t = useTranslation();

  if (advice.length === 0) {
    return <span className="text-xs text-muted">—</span>;
  }

  return (
    <ul className="flex min-w-64 flex-col gap-2">
      {advice.map((each, index) => (
        <li key={index} className="text-xs">
          <div className="flex items-center gap-1.5">
            <span className={`rounded border px-1.5 py-0.5 font-medium ${SEVERITY_STYLE[each.severity].badge}`}>
              {t(SEVERITY_STYLE[each.severity].labelKey)}
            </span>
            <span className="font-medium text-foreground">{each.problem}</span>
          </div>
          <p className="mt-0.5 text-secondary">{each.explanation}</p>
          <p className="mt-0.5 text-foreground">
            <span className="font-medium">{t("invoiceAudit.advice.action")}</span> {each.action}
          </p>
        </li>
      ))}
    </ul>
  );
}
