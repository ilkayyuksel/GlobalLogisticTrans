"use client";

import type { InvoicePriceReliability } from "@/lib/api/invoice-audit";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { TranslationKey } from "@/lib/i18n/translations";

/**
 * Why a line's stored price was not relied on, and the two roads behind it.
 *
 * The backend decides; this only shows its answer. The Trip's own road and the
 * road its price was made on stand side by side, so an operator can SEE a
 * doubtful match — `Quay 869 → Beveren` priced on `Quay 869 → Kallo (Beveren)` —
 * instead of having to trust a status.
 */
export function InvoicePriceReliabilityNote({
  reliability,
}: {
  reliability: InvoicePriceReliability;
}) {
  const t = useTranslation();
  const evidence = reliability.routeEvidence;

  return (
    <div className="space-y-0.5 text-xs text-warning">
      {reliability.problem ? (
        <p>{t(`invoiceAudit.reliability.${reliability.problem}` as TranslationKey)}</p>
      ) : null}
      {evidence?.tripRoute || evidence?.pricedRoute ? (
        <dl className="text-secondary">
          <div>
            <dt className="inline text-muted">{t("invoiceAudit.pricing.tripRoute")}: </dt>
            <dd className="inline">{evidence.tripRoute ?? "—"}</dd>
          </div>
          <div>
            <dt className="inline text-muted">{t("invoiceAudit.pricing.pricedRoute")}: </dt>
            <dd className="inline">{evidence.pricedRoute ?? "—"}</dd>
          </div>
        </dl>
      ) : null}
    </div>
  );
}
