import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import {
  PricingCalculationContext,
  PricingRuleConfiguration,
} from "./pricing-calculation-context";
import {
  PricingCalculationStep,
  PricingComponentCode,
  PricingLine,
} from "./pricing-line";
import { toStorableAmount } from "./pricing-money";
import { EkSource, ekSourceOf } from "../trip-pricing/effective-pricing";

/** pricing_rules.md numbers the Waiting Time fourth in the sequence. */
export const WAITING_TIME_CALCULATION_ORDER = 4;

/** No blocks means the component did not apply, so no line is produced. */
const NO_BILLABLE_BLOCKS = 0;

/**
 * Calculates the Waiting Time charge — step 4 of the pricing sequence.
 *
 *   if waited < threshold: nothing is charged
 *   billableMinutes = max(0, waited - free)
 *   blocks          = ceil(billableMinutes / blockMinutes)
 *   amount          = blocks * blockPrice
 *
 * ── THE THRESHOLD AND THE ALLOWANCE ARE TWO DIFFERENT RULES ─────────────────
 * The threshold decides WHETHER waiting is charged; the allowance decides HOW
 * MUCH of it is chargeable once it is. Both apply, in that order.
 *
 * With a 2-hour allowance and a 2h30 threshold, a wait of 2h15 costs nothing
 * even though it already exceeds the allowance, while 2h30 is charged for the
 * 30 minutes beyond the allowance — not for the 0 minutes beyond the
 * threshold. That is the business rule as the operator stated it, and it
 * cannot be expressed by either value alone: the allowance is what is
 * subtracted, the threshold is what must be reached first.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Every block that is STARTED is charged in full, which is what makes one
 * minute past a block boundary cost a whole block.
 *
 * A Trip with nothing billable produces no line at all, rather than a line of
 * zero: the component did not apply. A Trip with billable blocks always
 * produces one, including when the configured price is zero — there the waiting
 * time was charged, at nothing. The two cases look identical in money and are
 * deliberately different in the breakdown.
 *
 * Waiting time is priced from Trip data alone, so this step ignores what earlier
 * steps produced and declares only the context.
 *
 * ── EK IS THE HIGHER OF IT AND THE CONFIRMATIONS (owner, November 2026) ─────
 * When the Trip's Cost Confirmations add up to MORE, they are the EK and this
 * line is stored at €0 — still written, its blocks and price kept, so the
 * charge stays readable. See `ekSourceOf`.
 *
 * The percentage-free arithmetic is Decimal, and the amount is rounded exactly
 * once. Amounts are never logged.
 */
@Injectable()
export class WaitingTimeCalculator implements PricingCalculationStep {
  constructor(private readonly logger: AppLoggerService) {
    this.logger.setContext(WaitingTimeCalculator.name);
  }

  calculate(context: PricingCalculationContext): PricingLine[] {
    this.logger.log("Waiting time calculation started", {
      tripId: context.tripId,
    });

    const charge = waitingTimeChargeOf(context);
    const outweighed = charge !== null && isOutweighedByConfirmations(charge.amount, context);
    const lines = charge === null ? [] : [waitingTimeLine(charge, context.rules, outweighed)];

    this.logger.log("Waiting time calculation completed", {
      tripId: context.tripId,
      lineCount: lines.length,
      outweighedByCostConfirmations: outweighed,
    });

    return lines;
  }
}

/** What the waiting time is charged at, before EK chooses between its sources. */
export interface WaitingTimeCharge {
  readonly billableMinutes: number;
  readonly blocks: number;
  readonly amount: Prisma.Decimal;
}

/**
 * The waiting time's own charge, or null when nothing is billable — the
 * calculation above, as one function, so the Cost Confirmation step compares
 * EK against exactly this figure rather than a second calculation of it.
 */
export function waitingTimeChargeOf(context: PricingCalculationContext): WaitingTimeCharge | null {
  const billableMinutes = billableMinutesOf(context);
  const blocks = Math.ceil(billableMinutes / context.rules.waitingTimeBlockMinutes);

  if (blocks <= NO_BILLABLE_BLOCKS) {
    return null;
  }

  return {
    billableMinutes,
    blocks,
    amount: toStorableAmount(new Prisma.Decimal(blocks).mul(context.rules.waitingTimeBlockPrice)),
  };
}

/**
 * The minutes this Trip is charged for.
 *
 * Nothing at all until the threshold is reached; from there, the total wait
 * less the free allowance. The result is never negative. Every started block
 * counts: both operands are whole minutes and the block size is guaranteed
 * positive by PricingRuleResolver, so the ceiling above is safe.
 */
function billableMinutesOf(context: PricingCalculationContext): number {
  if (context.waitingTimeMinutes < context.rules.waitingTimeThresholdMinutes) {
    return 0;
  }

  return Math.max(0, context.waitingTimeMinutes - context.rules.waitingTimeFreeMinutes);
}

/** The Cost Confirmations add up to more: they are the EK (`ekSourceOf`). */
function isOutweighedByConfirmations(charge: Prisma.Decimal, context: PricingCalculationContext): boolean {
  const confirmation = context.costConfirmation;

  return (
    confirmation !== null &&
    ekSourceOf(charge, new Prisma.Decimal(confirmation.amount)) === EkSource.COST_CONFIRMATION
  );
}

/**
 * The block count and the configured price are kept on the line as quantity
 * and unit price, so the charge can be read back without recalculating it —
 * also when the confirmations outweigh it and it contributes €0 to EK.
 */
function waitingTimeLine(
  charge: WaitingTimeCharge,
  rules: PricingRuleConfiguration,
  outweighed: boolean,
): PricingLine {
  return {
    component: PricingComponentCode.WAITING_TIME,
    // Matches the wording used by the seeded pricing snapshots.
    description: `${charge.billableMinutes} billable minutes`,
    amount: outweighed ? new Prisma.Decimal(0) : charge.amount,
    calculationOrder: WAITING_TIME_CALCULATION_ORDER,
    quantity: new Prisma.Decimal(charge.blocks),
    unitPrice: new Prisma.Decimal(rules.waitingTimeBlockPrice),
    customPropertyId: null,
  };
}
