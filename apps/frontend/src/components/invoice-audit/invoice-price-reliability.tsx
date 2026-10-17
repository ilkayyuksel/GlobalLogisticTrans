"use client";

import type { InvoicePriceReliability } from "@/lib/api/invoice-audit";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { TranslationKey } from "@/lib/i18n/translations";

/**
 * Why a line's stored price was not relied on, with the two roads and the
 * system's match method beside it.
 *
 * The backend decides, from the system's own stored match; this only shows its
 * answer. The roads are information — `Eindhout` priced on `LAAKDAL (EINDHOUT)`
 * is a match the system made — never a reason of their own.
 */
export function InvoicePriceReliabilityNote({
  reliability,
}: {
  reliability: InvoicePriceReliability;
}) {
  const t = useTranslation();
  const route = reliability.route;

  return (
    <div className="space-y-0.5 text-xs text-warning">
      {reliability.problem ? (
        <p>{t(`invoiceAudit.reliability.${reliability.problem}` as TranslationKey)}</p>
      ) : null}
      {route?.tripRoute || route?.pricedRoute ? (
        <dl className="text-secondary">
          <div>
            <dt className="inline text-muted">{t("invoiceAudit.pricing.tripRoute")}: </dt>
            <dd className="inline">{route.tripRoute ?? "—"}</dd>
          </div>
          <div>
            <dt className="inline text-muted">{t("invoiceAudit.pricing.pricedRoute")}: </dt>
            <dd className="inline">{route.pricedRoute ?? "—"}</dd>
          </div>
          {route.matchMethod ? (
            <div>
              <dt className="inline text-muted">{t("pricing.route.method")}: </dt>
              <dd className="inline">{t(`pricing.route.method.${route.matchMethod}`)}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </div>
  );
}
