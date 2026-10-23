"use client";

import { InvoicePriceComparisonTable } from "@/components/invoice-audit/invoice-price-comparison";
import { InvoicePriceReliabilityNote } from "@/components/invoice-audit/invoice-price-reliability";
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
 * A line whose prices this system raised is a line that was matched and
 * understood; it is marked, not flagged. So is a line whose invoice states MORE
 * than this system: nothing is lowered, it is only pointed out. The warning
 * colour stays for the answers an operator has to act on — a difference no cell
 * can carry, a stored price nobody can stand behind, a cell holding no amount.
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
  INVOICE_HIGHER: {
    labelKey: "invoiceAudit.pricing.invoiceHigher",
    badge: "border-border bg-hover text-secondary",
  },
  NOT_DISTRIBUTABLE: {
    labelKey: "invoiceAudit.pricing.notDistributable",
    badge: "border-warning/40 bg-warning/10 text-warning",
  },
  PRICE_UNRELIABLE: {
    labelKey: "invoiceAudit.pricing.priceUnreliable",
    badge: "border-warning/40 bg-warning/10 text-warning",
  },
  AMOUNT_UNREADABLE: {
    labelKey: "invoiceAudit.pricing.amountUnreadable",
    badge: "border-warning/40 bg-warning/10 text-warning",
  },
  COMBINATION_REVIEW: {
    labelKey: "invoiceAudit.pricing.combinationReview",
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
 * Every compared component is shown Excel beside Trano with what the corrected
 * document will say (`invoice-price-comparison.tsx`) — because a total or a
 * count would not tell an operator what changed in their document.
 */
export function InvoicePricingCell({ row }: { row: InvoiceAuditRow }) {
  const t = useTranslation();

  /*
   * A line with no Trip has nothing to compare against, and says so once. A line
   * this check added HAS one: its prices are compared exactly like an invoice
   * line's — only its payment is refused.
   */
  if (row.status !== "MATCHED" && row.status !== "ADDED_MISSING" && row.status !== "COST_LINE") {
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

      {row.priceReliability && !row.priceReliability.reliable ? (
        <InvoicePriceReliabilityNote reliability={row.priceReliability} />
      ) : null}

      {/* Older answers carry no comparison: they show their differences as before. */}
      {(row.comparisons ?? []).length > 0 ? (
        <InvoicePriceComparisonTable comparisons={row.comparisons} />
      ) : row.differences.length > 0 ? (
        <ul className="space-y-0.5">
          {row.differences.map((difference) => (
            <li
              key={`${difference.component}-${difference.column ?? ""}`}
              className="text-xs tabular-nums"
            >
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
  const label = <span className="text-muted">{difference.component}:</span>;

  switch (difference.kind) {
    case "NOT_PLACEABLE":
      return (
        <span className="text-warning">
          {difference.component}: {toMoney(difference.invoiceValue)} →{" "}
          {toMoney(difference.expectedValue)} · {t("invoiceAudit.pricing.notPlaced")}
        </span>
      );
    case "UNREADABLE":
      return (
        <span className="text-warning">
          {difference.component}: {t("invoiceAudit.pricing.unreadable")}
        </span>
      );
    case "INVOICE_HIGHER":
      return (
        <span className="text-secondary">
          {label} {toMoney(difference.invoiceValue)} · {toMoney(difference.expectedValue)} ·{" "}
          {t("invoiceAudit.pricing.notLowered")}
        </span>
      );
    case "KEEP_AMOUNT":
      return (
        <span className="text-secondary">
          {label} {toMoney(difference.correctedValue)} · {t("invoiceAudit.pricing.keptAmount")}
        </span>
      );
    case "REMOVE":
      return (
        <span className="text-secondary">
          {label} <span className="line-through">{toMoney(difference.invoiceValue)}</span>{" "}
          · {t("invoiceAudit.pricing.removed")}
        </span>
      );
    default:
      return (
        <span className="text-secondary">
          {label} <span className="line-through">{toMoney(difference.invoiceValue)}</span> →{" "}
          <span className="font-medium text-foreground">
            {toMoney(difference.correctedValue)}
          </span>
        </span>
      );
  }
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
