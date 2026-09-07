import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

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
  /**
   * Every contributing confirmation's own reference, NEWEST FIRST.
   *
   * A list rather than one number, because a Trip may be confirmed in
   * instalments and a breakdown has to say which documents an amount came
   * from. Never empty: a Trip with no confirmation is reported as null.
   */
  readonly ccNumbers: readonly string[];
  /** The SUM of every confirmation, as fixed-2 text. */
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
   * What this Trip's confirmations add up to, or null when it has none.
   *
   * ── THE SUM, NOT THE LATEST ─────────────────────────────────────────────
   * A Trip confirmed at €100, then €25, then €40 is worth €165. Each arrival
   * is its own document and its own row; what the Trip is WORTH is their
   * total. Only the Ritten row picks a single one, and that is a display rule.
   *
   * Added as Decimal, never as JS numbers: money is exact in this system, and
   * `0.1 + 0.2` is the reason. The result leaves as the same fixed-2 text a
   * single confirmation always did, so the calculation context is unchanged in
   * shape.
   *
   * Null is an ordinary answer and is NOT the same as an amount of zero: a Trip
   * with no confirmation prices without an EK line at all. A Trip whose
   * confirmations happen to sum to zero DOES get a line — the documents exist,
   * and that is a different fact from their absence.
   */
  async findForTrip(
    tripId: string,
  ): Promise<CostConfirmationPricingInput | null> {
    const rows = await this.repository.findAllByTrip(tripId);

    if (rows.length === 0) {
      return null;
    }

    const total = rows.reduce(
      (running, row) => running.plus(row.amount),
      new Prisma.Decimal(0),
    );

    return {
      ccNumbers: rows.map((row) => row.ccNumber),
      amount: total.toFixed(MONEY_DECIMAL_PLACES),
    };
  }
}
