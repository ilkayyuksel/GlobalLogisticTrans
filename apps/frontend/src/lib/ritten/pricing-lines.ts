import type { PricingSnapshot, TripPricingItem } from "@/lib/api/types";

/**
 * Reading a stored pricing snapshot for an export.
 *
 * ── THIS IS NOT A PRICING ENGINE, AND MUST NEVER BECOME ONE ─────────────────
 * Every number here is one the Pricing Engine already calculated and stored.
 * Nothing is derived, summed from a rate, or reconstructed from configuration:
 * this file CLASSIFIES lines by the component code the backend puts on them,
 * and presents the amounts as they were stored.
 *
 * The one arithmetic that happens is adding several stored fixed-property lines
 * into a single "Others" cell, which the export asks for — a sum of stored
 * amounts, not a calculation of them.
 *
 * If a Trip has no snapshot, every pricing cell is EMPTY. Not zero: a Trip that
 * has not been priced and a Trip priced at zero are different facts, and an
 * exported 0.00 would state the second while meaning the first.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** The component codes this export understands, as the backend spells them. */
export const PRICING_CODES = {
  basePrice: "BASE_PRICE",
  fuel: "FUEL_SURCHARGE",
  combination: "COMBINATION",
  toll: "TOLL",
  tunnel: "TUNNEL",
  waitingTime: "WAITING_TIME",
  customProperty: "CUSTOM_PROPERTY",
} as const;

export interface PricedTripLines {
  /** Null everywhere means "no snapshot" — never "zero". */
  readonly basePrice: number | null;
  readonly fuel: number | null;
  readonly combination: number | null;
  readonly toll: number | null;
  readonly tunnel: number | null;
  readonly waitingTime: number | null;
  /** Fixed Custom Properties, summed. Route-priced ones are NOT here. */
  readonly others: number | null;
  /** The fixed-property lines behind `others`, for the Info/Kosten columns. */
  readonly customPropertyAmounts: readonly number[];
}

export const NO_PRICING: PricedTripLines = {
  basePrice: null,
  fuel: null,
  combination: null,
  toll: null,
  tunnel: null,
  waitingTime: null,
  others: null,
  customPropertyAmounts: [],
};

/**
 * Money as a number, from the fixed-2 string the backend sends.
 *
 * The string is authoritative — it comes from a database NUMERIC — and it is
 * parsed only here, at the edge, so a spreadsheet can hold a real number and
 * format it as currency. Nothing adds these except the `others` sum below.
 */
function toAmount(value: string): number {
  return Number(value);
}

function sumOf(items: readonly TripPricingItem[]): number {
  return items.reduce((total, item) => total + toAmount(item.amount), 0);
}

/** The single line carrying a code, or null when the snapshot has none. */
function lineFor(
  items: readonly TripPricingItem[],
  code: string,
): number | null {
  const matching = items.filter((item) => item.pricingComponentCode === code);

  return matching.length === 0 ? null : sumOf(matching);
}

export function toPricedTripLines(
  snapshot: PricingSnapshot | null,
): PricedTripLines {
  if (!snapshot) {
    return NO_PRICING;
  }

  const { items } = snapshot;

  /*
   * Only the FIXED custom properties. A route-priced one — Toll, Tunnel — is
   * stored under its own component code, so it lands in its own column and
   * cannot be double-counted here.
   */
  const fixedCustomProperties = items.filter(
    (item) => item.pricingComponentCode === PRICING_CODES.customProperty,
  );

  return {
    basePrice: lineFor(items, PRICING_CODES.basePrice),
    fuel: lineFor(items, PRICING_CODES.fuel),
    combination: lineFor(items, PRICING_CODES.combination),
    toll: lineFor(items, PRICING_CODES.toll),
    tunnel: lineFor(items, PRICING_CODES.tunnel),
    waitingTime: lineFor(items, PRICING_CODES.waitingTime),
    others:
      fixedCustomProperties.length === 0
        ? null
        : sumOf(fixedCustomProperties),
    customPropertyAmounts: fixedCustomProperties.map((item) =>
      toAmount(item.amount),
    ),
  };
}

/**
 * A snapshot that exists but has no base price.
 *
 * Reported rather than repaired: the export must not invent a base price, and a
 * priced Trip missing the one line every strategy produces is a real
 * inconsistency somebody should look at.
 */
export function hasMissingBasePrice(
  snapshot: PricingSnapshot | null,
): boolean {
  return snapshot !== null && lineFor(snapshot.items, PRICING_CODES.basePrice) === null;
}
