import { Injectable } from "@nestjs/common";

import { MONEY_DECIMAL_PLACES } from "../common/dto/money";
import { CostConfirmationReadRepository } from "./cost-confirmation-read.repository";

/**
 * What a Cost Confirmation contributes to a price: a reference and an amount.
 *
 * The amount leaves as the fixed-2 STRING the NUMERIC column holds. Money is
 * never a float in this system, and the calculation context is defined in exact
 * decimal text for exactly that reason.
 */
export interface CostConfirmationPricingInput {
  readonly ccNumber: string;
  readonly amount: string;
}

/**
 * The narrow Cost Confirmation read side.
 *
 * ── WHY THE ENGINE DOES NOT USE CostConfirmationService ─────────────────────
 * That service owns the write rules — one confirmation per Trip, the first one
 * is authoritative, a second is refused — and recording one must now leave the
 * Trip's pricing current, so it calls the Pricing Engine. The Engine reading
 * back through it would close the cycle.
 *
 * Reading a confirmed amount needs none of those rules, so it is separated out
 * and sits below both. This module imports nothing but Prisma, which is global.
 * ────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class CostConfirmationReadService {
  constructor(private readonly repository: CostConfirmationReadRepository) {}

  /**
   * The confirmation this Trip carries, or null when it has none.
   *
   * Null is an ordinary answer and is NOT the same as an amount of zero: a Trip
   * with no confirmation prices without an EK line at all.
   */
  async findForTrip(
    tripId: string,
  ): Promise<CostConfirmationPricingInput | null> {
    const row = await this.repository.findByTrip(tripId);

    if (row === null) {
      return null;
    }

    return {
      ccNumber: row.ccNumber,
      amount: row.amount.toFixed(MONEY_DECIMAL_PLACES),
    };
  }
}
