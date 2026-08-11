import { Prisma } from "@prisma/client";

import { PricingCalculationContext } from "./pricing-calculation-context";

/**
 * One calculated line of a pricing breakdown.
 *
 * The shape mirrors `trip_pricing_item` deliberately: when the persistence
 * phase arrives, a line maps onto a row field for field, with no translation
 * step that could quietly change a number on the way to the database.
 *
 * `amount` is a Decimal, never a JavaScript number. Money that passes through a
 * float has already lost the exactness the NUMERIC columns exist to preserve,
 * and a breakdown must add up to its total exactly.
 */
export interface PricingLine {
  /** Classifies the line. Matches a `pricing_component.code` in the catalog. */
  readonly component: PricingComponentCode;
  readonly description: string;
  readonly amount: Prisma.Decimal;
  /** Position in the sequence defined by pricing_rules.md. */
  readonly calculationOrder: number;
  /** How many units the line charges for. Null when the line is a flat amount. */
  readonly quantity: Prisma.Decimal | null;
  readonly unitPrice: Prisma.Decimal | null;
}

/**
 * The component codes this Engine can currently produce.
 *
 * Only the codes actually implemented appear here. The catalog holds eight, but
 * listing the six that no step produces yet would suggest they are supported.
 * Each future phase adds its own.
 *
 * Both codes are the ones seeded in `pricing_component` and required by
 * database_schema.md §8.2, which names the catalog the single source of truth
 * for classifying a pricing item. pricing_rules.md uses longer prose names —
 * "Base Route Price", "Combination Surcharge" — but the catalog code is what
 * the data uses, and a code with no catalog row would fail the foreign key the
 * moment items are persisted.
 */
export const PricingComponentCode = {
  BASE_PRICE: "BASE_PRICE",
  COMBINATION: "COMBINATION",
} as const;

export type PricingComponentCode =
  (typeof PricingComponentCode)[keyof typeof PricingComponentCode];

/**
 * One step of the pricing sequence.
 *
 * pricing_rules.md defines a fixed ordered sequence of components and states
 * that "changing this order may produce different pricing results", so the
 * Engine runs an ordered list of steps rather than a hardcoded chain of calls.
 * A new component is a new step added to that list — the existing steps are not
 * touched, and neither is the Engine's own loop.
 *
 * `precedingLines` carries what earlier steps produced, because later steps
 * depend on them: the Fuel Surcharge is calculated on the base price alone, and
 * the Final Total on all of them. A step must never mutate it.
 */
export interface PricingCalculationStep {
  calculate(
    context: PricingCalculationContext,
    precedingLines: readonly PricingLine[],
  ): PricingLine[];
}

/**
 * Injection token for the ordered step list.
 *
 * The ORDER of the provided array is the calculation order and is part of the
 * business rules, not an implementation detail.
 */
export const PRICING_CALCULATION_STEPS = Symbol("PRICING_CALCULATION_STEPS");
