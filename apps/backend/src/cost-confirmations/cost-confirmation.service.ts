import { Injectable } from "@nestjs/common";
import { CostConfirmation } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { PricingRecalculationService } from "../pricing-engine/pricing-recalculation.service";
import { EffectivePricingDto } from "../trip-pricing/dto/effective-pricing.dto";
import { CostConfirmationRepository } from "./cost-confirmation.repository";
import { CostConfirmationDto } from "./dto/cost-confirmation-response.dto";

/**
 * What a confirmed cost means, and what it deliberately does not.
 *
 * ── IT IS NOT WAITING TIME ──────────────────────────────────────────────────
 * A Trip carries `waitingTimeMinutes`, which an operator enters and the Pricing
 * Engine prices through the configured rule. A Cost Confirmation is the amount
 * EUCON will pay for those minutes. The two answer different questions — how
 * long did we wait, and what will we be paid for it — and neither replaces the
 * other. Recording a confirmation changes no minute of waiting time, no pricing
 * line and no status.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * ── AND IT IS NOT OURS TO EDIT ──────────────────────────────────────────────
 * There is no update and no delete here. A confirmation is a statement by
 * somebody else; an amount an administrator could rewrite would be a claim
 * about what Eucon said.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * ── ONE PER TRIP ────────────────────────────────────────────────────────────
 * Eucon confirms a Trip's waiting time once. The FIRST confirmation is the
 * authoritative one: a later, different one is refused rather than applied, and
 * the database says so too — `cost_confirmation.trip_id` is unique, so no path
 * through this code can produce a second even if this check were bypassed.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * ── BUT IT IS A PRICING INPUT ───────────────────────────────────────────────
 * A confirmed amount becomes the Trip's EK line and therefore moves its Totaal.
 * So recording one AWAITS a recalculation and answers with the result: nothing
 * is fire-and-forget, because a caller that returned first would report the
 * figures from before the confirmation existed.
 *
 * The confirmation is kept whatever pricing does. It is a statement by somebody
 * else and it arrived; a Trip whose route is not configured cannot be priced
 * yet, and that is a configuration gap to fill rather than a reason to discard
 * evidence. The result then carries `pricing: null` with a reason code — never
 * the previous figures — and the Trip's status is untouched throughout.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** What became of one confirmation. */
export type CostConfirmationOutcome =
  /** Recorded against the Trip. */
  | "RECORDED"
  /**
   * The same confirmation again — same Trip, same number. Harmless, and common
   * when one message arrives twice. Nothing was written.
   */
  | "ALREADY_RECORDED"
  /**
   * A DIFFERENT confirmation for a Trip that already has one. Refused: the
   * existing amount stays authoritative, and nothing is overwritten or summed.
   */
  | "CC_ALREADY_EXISTS";

export interface CostConfirmationResult {
  readonly outcome: CostConfirmationOutcome;
  readonly confirmation: CostConfirmation | null;
  /**
   * The Trip's complete effective pricing after this confirmation, or null.
   *
   * Present only on RECORDED — the one outcome that WROTE something. Nothing
   * was written for ALREADY_RECORDED or CC_ALREADY_EXISTS, so there is nothing
   * to have changed and no recalculation is run: repricing on a duplicate
   * message would burn a calculation to produce the snapshot that is already
   * stored.
   *
   * Null on RECORDED too when the Trip could not be priced — see `reasonCode`.
   * It is never the pricing from before the confirmation was recorded.
   */
  readonly pricing: EffectivePricingDto | null;
  /** Why there is no pricing, as a stable code. Null when pricing is present. */
  readonly reasonCode: string | null;
}

export interface RecordCostConfirmationCommand {
  readonly tripId: string;
  readonly pdfDocumentId: string;
  readonly ccNumber: string;
  readonly costCode: string;
  /** Fixed-2 decimal string. Never a float. */
  readonly amount: string;
  readonly currency: string;
  readonly receivedAt: Date;
}

@Injectable()
export class CostConfirmationService {
  constructor(
    private readonly repository: CostConfirmationRepository,
    private readonly recalculation: PricingRecalculationService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(CostConfirmationService.name);
  }

  /**
   * Records the confirmation of a Trip that has none.
   *
   * Two ways it does not write, and they mean different things:
   *
   *   the SAME number again  → harmless. One message arriving twice, most
   *                            often under another filename. Reported, not
   *                            refused, and nothing written a second time.
   *   a DIFFERENT number     → refused. The Trip already has its confirmed
   *                            cost, and a second one is not something this
   *                            business has. The first stays authoritative:
   *                            nothing is overwritten, nothing is summed.
   */
  async record(
    command: RecordCostConfirmationCommand,
  ): Promise<CostConfirmationResult> {
    const existing = await this.repository.findByTrip(command.tripId);

    if (existing && existing.ccNumber === command.ccNumber) {
      this.logger.log("Cost confirmation already recorded", {
        tripId: command.tripId,
        ccNumber: command.ccNumber,
      });

      return {
        outcome: "ALREADY_RECORDED",
        confirmation: existing,
        // Nothing was written, so nothing can have changed.
        pricing: null,
        reasonCode: null,
      };
    }

    if (existing) {
      this.logger.warn("A second cost confirmation was refused", {
        tripId: command.tripId,
        existingCcNumber: existing.ccNumber,
        refusedCcNumber: command.ccNumber,
      });

      return {
        outcome: "CC_ALREADY_EXISTS",
        confirmation: existing,
        pricing: null,
        reasonCode: null,
      };
    }

    const confirmation = await this.repository.create({
      tripId: command.tripId,
      pdfDocumentId: command.pdfDocumentId,
      ccNumber: command.ccNumber,
      costCode: command.costCode,
      amount: command.amount,
      currency: command.currency,
      receivedAt: command.receivedAt,
    });

    this.logger.log("Cost confirmation recorded", {
      tripId: command.tripId,
      ccNumber: command.ccNumber,
      costCode: command.costCode,
      amount: command.amount,
      currency: command.currency,
    });

    /*
     * After the row is committed, so the Engine reads the confirmation that
     * was just written rather than the absence it replaced. One recalculation,
     * whatever else the Trip carries.
     */
    const outcome = await this.recalculation.recalculate(command.tripId);

    return {
      outcome: "RECORDED",
      confirmation,
      pricing: outcome.pricing,
      reasonCode: outcome.reasonCode,
    };
  }

  /** The confirmation of each Trip on a page, keyed by Trip id. */
  async findForTrips(
    tripIds: readonly string[],
  ): Promise<Map<string, CostConfirmationDto>> {
    const byTrip = new Map<string, CostConfirmationDto>();
    const rows = await this.repository.findForTrips(tripIds);

    for (const row of rows) {
      byTrip.set(row.tripId, toResponse(row));
    }

    return byTrip;
  }
}

/**
 * The public shape.
 *
 * The amount leaves as the fixed-2 STRING the database holds. A Decimal
 * serialised as a JSON number would be a float the moment it reached a browser,
 * and money is never a float in this system.
 */
export function toResponse(row: CostConfirmation): CostConfirmationDto {
  return {
    id: row.id,
    ccNumber: row.ccNumber,
    costCode: row.costCode,
    amount: row.amount.toFixed(2),
    currency: row.currency,
    receivedAt: row.receivedAt,
    pdfDocumentId: row.pdfDocumentId,
  };
}
