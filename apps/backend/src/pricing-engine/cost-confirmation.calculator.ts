import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { PricingCalculationContext } from "./pricing-calculation-context";
import {
  PricingComponentCode,
  PricingLine,
  type PricingCalculationStep,
} from "./pricing-line";
import { toStorableAmount } from "./pricing-money";

/**
 * The cost Eucon confirmed for this Trip, as a pricing component.
 *
 * ── WHY THIS IS A REAL COMPONENT ────────────────────────────────────────────
 * A Cost Confirmation is an amount the customer has agreed to, and it belongs
 * in what the Trip is worth. Reading it only at display time would leave the
 * persisted `total_price` disagreeing with the total an operator sees — two
 * numbers for the same Trip, one of them wrong wherever it was read. So it is
 * calculated, stored and summed like every other component.
 *
 * It is presented as EK. That grouping lives in the read layer, not here: this
 * step's job is to state what the document says, and naming it is somebody
 * else's.
 *
 * ── IT CALCULATES NOTHING ───────────────────────────────────────────────────
 * The amount is taken from the confirmation VERBATIM. There is no rate, no
 * threshold and no rounding, because the figure was not derived — it was
 * confirmed, by the party paying it, in a document this system stored. Applying
 * arithmetic to it would be inventing a rule nobody agreed to.
 *
 * ── ONE PER TRIP ────────────────────────────────────────────────────────────
 * `cost_confirmation.trip_id` is unique, so a Trip has at most one, and this
 * step can produce at most one line. A Trip without a confirmation produces
 * none at all — not a zero, which would claim a confirmed cost of nothing.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Last in the sequence: it depends on nothing and nothing depends on it. */
const CALCULATION_ORDER = 80;

@Injectable()
export class CostConfirmationCalculator implements PricingCalculationStep {
  constructor(private readonly logger: AppLoggerService) {
    this.logger.setContext(CostConfirmationCalculator.name);
  }

  calculate(context: PricingCalculationContext): PricingLine[] {
    const confirmation = context.costConfirmation;

    if (!confirmation) {
      this.logger.log("No cost confirmation for this Trip", {
        tripId: context.tripId,
      });

      return [];
    }

    this.logger.log("Cost confirmation priced", {
      tripId: context.tripId,
      // The reference identifies the document; the amount is never logged.
      ccNumber: confirmation.ccNumber,
    });

    return [
      {
        component: PricingComponentCode.COST_CONFIRMATION,
        // The document's own reference, so a breakdown says WHICH confirmation
        // an amount came from rather than merely that one existed.
        description: `Cost confirmation ${confirmation.ccNumber}`,
        // Verbatim, then stored at the schema's two places. The confirmation
        // already holds a fixed-2 amount, so this rounds nothing in practice —
        // it states the precision rather than trusting the string.
        amount: toStorableAmount(new Prisma.Decimal(confirmation.amount)),
        calculationOrder: CALCULATION_ORDER,
        quantity: null,
        unitPrice: null,
        customPropertyId: null,
      },
    ];
  }
}
