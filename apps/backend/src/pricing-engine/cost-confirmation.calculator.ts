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
import { waitingTimeChargeOf } from "./waiting-time.calculator";
import { EkSource, ekSourceOf } from "../trip-pricing/effective-pricing";

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
 * ── SEVERAL CONFIRMATIONS, ONE LINE ─────────────────────────────────────────
 * A Trip may be confirmed in instalments — €100, then €25, then €40 — and it is
 * worth their sum. `trip_id` used to be unique and this step read a single
 * amount; it now reads the TOTAL, which the read side adds up as Decimal.
 *
 * Still ONE line, because a component appears once in a breakdown: two rows
 * carrying the same component code would change what a pricing item means and
 * would be counted twice by anything that groups by component. The individual
 * documents are not lost — every confirmation is its own row, its own PDF and
 * its own history event — and the description names them so a breakdown says
 * WHICH confirmations produced the figure.
 *
 * A Trip without any confirmation produces no line at all — not a zero, which
 * would claim a confirmed cost of nothing.
 *
 * ── EK IS THE HIGHER OF THE WAITING TIME AND THE CONFIRMATIONS ──────────────
 * EK is ONE source, by business rule (owner, November 2026): the HIGHER of the
 * manual waiting time's charge and the confirmations' sum. The two are never
 * added — confirmations of €138.75 beside a waiting time of €55.00 are EK
 * €138.75, not €193.75; a waiting time of €150.00 beside them is EK €150.00.
 *
 * This replaces the rule under which any RECORDED waiting time, even one priced
 * at €0, superseded the confirmations: the amounts are compared now, whatever
 * is recorded. A WAIT confirmation from a PDF is one of the confirmations.
 *
 * When the waiting time is as high or higher, the line is still written — its
 * description keeps naming the documents, which is how Remarks shows the CC
 * references — but it contributes €0. When the confirmations are higher, the
 * waiting time's line contributes €0 instead (`WaitingTimeCalculator`). The
 * comparison is `ekSourceOf`, against the waiting time's own charge
 * (`waitingTimeChargeOf`) — never against an earlier EK. The confirmations
 * themselves are untouched: this decides only what they contribute to THIS
 * calculation, made from the current Trip and the current confirmations.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Last in the sequence: nothing depends on it. */
const CALCULATION_ORDER = 80;

const ZERO = new Prisma.Decimal(0);

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

    const confirmed = new Prisma.Decimal(confirmation.amount);
    const waitingTimeCharge = waitingTimeChargeOf(context)?.amount ?? ZERO;
    const isSuperseded = ekSourceOf(waitingTimeCharge, confirmed) === EkSource.WAITING_TIME;

    this.logger.log("Cost confirmation priced", {
      tripId: context.tripId,
      // The references identify the documents; no amount is ever logged.
      ccNumbers: confirmation.ccNumbers,
      confirmationCount: confirmation.ccNumbers.length,
      outweighedByWaitingTime: isSuperseded,
    });

    return [
      {
        component: PricingComponentCode.COST_CONFIRMATION,
        /*
         * The documents' own references, so a breakdown says WHICH
         * confirmations an amount came from rather than merely that some
         * existed. One reads exactly as it always did; several are listed in
         * arrival order, newest first.
         */
        description: describe(confirmation.ccNumbers),
        // Verbatim, then stored at the schema's two places. The read side
        // already summed the confirmations as Decimal and handed over a fixed-2
        // amount, so this rounds nothing in practice — it states the precision
        // rather than trusting the string.
        amount: isSuperseded
          ? ZERO
          : toStorableAmount(confirmed),
        calculationOrder: CALCULATION_ORDER,
        quantity: null,
        unitPrice: null,
        customPropertyId: null,
      },
    ];
  }
}

/**
 * What to call the line, from the confirmations that produced it.
 *
 * A single confirmation keeps the wording it has always had, so an existing
 * breakdown reads identically and nothing downstream sees a new shape for the
 * ordinary case.
 */
function describe(ccNumbers: readonly string[]): string {
  return ccNumbers.length === 1
    ? `Cost confirmation ${ccNumbers[0]}`
    : `Cost confirmations ${ccNumbers.join(", ")}`;
}
