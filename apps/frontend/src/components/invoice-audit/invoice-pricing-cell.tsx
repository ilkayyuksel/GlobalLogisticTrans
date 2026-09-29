"use client";

import type {
  InvoiceAuditRow,
  InvoicePricingDifference,
  InvoicePricingStatus,
} from "@/lib/api/invoice-audit";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { TranslationKey } from "@/lib/i18n/translations";

/**
 * How each pricing answer reads.
 *
 * ── CORRECTED IS NOT A PROBLEM ──────────────────────────────────────────────
 * A line whose prices this system corrected is a line that was matched and
 * understood; it is marked, not flagged. The yellow of a problem row stays for
 * the three answers an operator has to act on — no Trip, an unfinished one,
 * several — and one more: a difference that cannot be placed on a cell.
 */
const PRICING_STYLE: Record<
  InvoicePricingStatus,
  { readonly labelKey: TranslationKey; readonly badge: string }
> = {
  MATCHED_NO_CHANGES: {
    labelKey: "invoiceAudit.pricing.noChanges",
    badge: "border-success/40 bg-success/10 text-success",
  },
  PRICING_CORRECTED: {
    labelKey: "invoiceAudit.pricing.corrected",
    badge: "border-primary/40 bg-primary/10 text-primary",
  },
  NOT_DISTRIBUTABLE: {
    labelKey: "invoiceAudit.pricing.notDistributable",
    badge: "border-warning/40 bg-warning/10 text-warning",
  },
  NOT_COMPARED: {
    labelKey: "invoiceAudit.pricing.notCompared",
    badge: "border-border bg-hover text-muted",
  },
};

/**
 * What the pricing check made of one line.
 *
 * Every difference is shown as the invoice's own figure and the one that
 * replaces it — `Tarief €364,00 → €370,00` — because a total or a count would
 * not tell an operator what changed in their document.
 */
export function InvoicePricingCell({ row }: { row: InvoiceAuditRow }) {
  const t = useTranslation();

  /*
   * A line with no Trip has nothing to compare against, and says so once. A line
   * this check added HAS one: its prices are compared and corrected exactly like
   * an invoice line's — only its payment is refused.
   */
  if (row.status !== "MATCHED" && row.status !== "ADDED_MISSING") {
    return <span className="text-xs text-muted">—</span>;
  }

  const style = PRICING_STYLE[row.pricingStatus];

  return (
    <div className="space-y-1">
      <span
        className={`inline-block rounded-md border px-2 py-0.5 text-xs font-medium ${style.badge}`}
      >
        {t(style.labelKey)}
      </span>

      {row.differences.length > 0 ? (
        <ul className="space-y-0.5">
          {row.differences.map((difference) => (
            <li key={difference.component} className="text-xs tabular-nums">
              <Difference difference={difference} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Difference({ difference }: { difference: InvoicePricingDifference }) {
  const t = useTranslation();

  if (difference.correctedValue === null) {
    return (
      <span className="text-warning">
        {difference.component}: {toMoney(difference.invoiceValue)} →{" "}
        {toMoney(difference.expectedValue)} ·{" "}
        {t("invoiceAudit.pricing.notPlaced")}
      </span>
    );
  }

  return (
    <span className="text-secondary">
      <span className="text-muted">{difference.component}:</span>{" "}
      <span className="line-through">{toMoney(difference.invoiceValue)}</span> →{" "}
      <span className="font-medium text-foreground">
        {toMoney(difference.correctedValue)}
      </span>
    </span>
  );
}

/**
 * An amount as the invoice shows money.
 *
 * The backend sends a string at the money precision and it is printed as it is:
 * parsing it into a number to format it would be the one place a cent could go
 * missing, and nothing here calculates.
 */
function toMoney(amount: string | null): string {
  return amount === null ? "€—" : `€${amount}`;
}
