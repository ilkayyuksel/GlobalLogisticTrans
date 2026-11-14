import type { InvoiceRowMatch } from "../matching/invoice-row-match";
import { InvoicePricingStatus, type InvoiceRowPricing } from "./invoice-pricing-outcome";

/**
 * ── A TRIP WITHOUT A USABLE PRICE: ITS LINES ARE NOT TOUCHED (owner, November 2026)
 * A matched Trip that has no price this check can rely on — never priced, or a
 * stored price nobody can stand behind (`price-reliability.ts`) — leaves every
 * line it is charged on exactly as the customer wrote it: no amount, no
 * corrected booking, container or date, no Remarks. The one change is the
 * yellow, which `PRICE_UNRELIABLE` already gives.
 *
 * A price of 0,00 the system relied on is a price, and is not this.
 *
 * It takes precedence over every other rule of the check, so it is applied
 * once, here, on the outcome every other step reads — never as a condition
 * repeated in each of them.
 */
export function hasNoUsablePrice(outcome: InvoiceRowPricing | undefined): boolean {
  return outcome?.status === InvoicePricingStatus.PRICE_UNRELIABLE;
}

/**
 * The matches, with the corrections the match found taken off every line of a
 * Trip without a usable price — so the corrected document and its preview both
 * show that line as received.
 */
export function withoutCorrectionsOnUnpricedLines(
  matches: readonly InvoiceRowMatch[],
  pricing: ReadonlyMap<number, InvoiceRowPricing>,
): InvoiceRowMatch[] {
  return matches.map((match) =>
    hasNoUsablePrice(pricing.get(match.row.rowNumber))
      ? { ...match, containerCorrection: null, bookingCorrection: null, dateCorrection: null }
      : match,
  );
}
