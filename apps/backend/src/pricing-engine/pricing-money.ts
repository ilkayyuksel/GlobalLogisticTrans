import { Prisma } from "@prisma/client";

import { MONEY_DECIMAL_PLACES } from "../common/dto/money";

/**
 * The Engine's money rounding policy.
 *
 * Half-up is the convention an invoice reader expects. No source document
 * specifies a rule, so this is a decision rather than a transcription — it was
 * approved when the Base Price phase was implemented.
 */
export const MONEY_ROUNDING = Prisma.Decimal.ROUND_HALF_UP;

/**
 * Reduces an exact result to the precision the amount column can hold.
 *
 * Applied exactly once, at the end of a step, so a value is never rounded and
 * then rounded again — chained rounding drifts. Rounding here rather than
 * leaving it to the database keeps the amount a step produced identical to the
 * amount that will be stored.
 *
 * For a step whose amount comes straight from a two-decimal Setting this is a
 * no-op, and deliberately so: the line then guarantees its own precision
 * instead of depending on a validator elsewhere continuing to be strict.
 */
export function toStorableAmount(amount: Prisma.Decimal): Prisma.Decimal {
  return amount.toDecimalPlaces(MONEY_DECIMAL_PLACES, MONEY_ROUNDING);
}

/**
 * The Final Total: the exact Decimal sum of the amounts already on the lines.
 *
 * Nothing is recalculated and nothing is rounded again. Every line was rounded
 * once by the step that produced it, and the total is the sum of exactly those
 * stored figures — so the breakdown a reader adds up by hand always equals the
 * total printed beside it. Summing unrounded intermediates instead would differ
 * by a cent and make the invoice look wrong even though it was right.
 *
 * Decimal throughout. A JavaScript number cannot hold 0.1 + 0.2 exactly, and a
 * total is the one figure a customer checks.
 */
export function sumLineAmounts(
  amounts: readonly Prisma.Decimal[],
): Prisma.Decimal {
  return amounts.reduce(
    (running, amount) => running.plus(amount),
    new Prisma.Decimal(0),
  );
}
