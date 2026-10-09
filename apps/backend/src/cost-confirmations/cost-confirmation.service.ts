import { Injectable } from "@nestjs/common";
import { CostConfirmation } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { PricingRecalculationService } from "../pricing-engine/pricing-recalculation.service";
import { EffectivePricingDto } from "../trip-pricing/dto/effective-pricing.dto";
import {
  CostConfirmationRepository,
  violatesConfirmationIdentity,
} from "./cost-confirmation.repository";
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
 * ── EACH NUMBER ONCE PER TRIP ───────────────────────────────────────────────
 * A Trip may hold several confirmations — Eucon confirms in instalments — but
 * the SAME `cc_number` only once. This service checks first, and the database
 * says so too: `(trip_id, cc_number)` is unique, so two imports of one document
 * racing each other still produce one row. See `record`.
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
  | "ALREADY_RECORDED";

export interface CostConfirmationResult {
  readonly outcome: CostConfirmationOutcome;
  readonly confirmation: CostConfirmation | null;
  /**
   * The Trip's complete effective pricing after this confirmation, or null.
   *
   * Present only on RECORDED — the one outcome that WROTE something. Nothing
   * was written for ALREADY_RECORDED, so there is nothing to have changed and
   * no recalculation is run: repricing on a duplicate message would burn a
   * calculation to produce the snapshot that is already stored.
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
   * Records a confirmation against its Trip, whatever the Trip's status.
   *
   *   a NEW number           → recorded, and the Trip is repriced;
   *   the SAME number again  → harmless. One message arriving twice, most
   *                            often under another filename. Reported as
   *                            ALREADY_RECORDED, and nothing written again.
   */
  async record(
    command: RecordCostConfirmationCommand,
  ): Promise<CostConfirmationResult> {
    const existing = await this.repository.findAllByTrip(command.tripId);

    /*
     * ── THE ONE THING THAT IS STILL REFUSED ─────────────────────────────────
     * The SAME confirmation arriving twice. `cc_number` is Eucon's own
     * reference for the document, so two rows carrying it would be one amount
     * counted twice — and the aggregate is money.
     *
     * Every OTHER confirmation is kept. A Trip confirmed in instalments —
     * €100, then €25, then €40 — is worth their sum, and refusing the later
     * ones (which is what this service used to do) lost both the money and the
     * evidence for it.
     */
    const duplicate = existing.find(
      (confirmation) => confirmation.ccNumber === command.ccNumber,
    );

    if (duplicate) {
      return this.alreadyRecorded(command, duplicate);
    }

    const inserted = await this.insertUnlessRecordedConcurrently(command);

    if (inserted.outcome === "ALREADY_RECORDED") {
      return this.alreadyRecorded(command, inserted.confirmation);
    }

    const confirmation = inserted.confirmation;

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

  /**
   * Inserts the confirmation, or finds the one a concurrent import inserted.
   *
   * ── THE RACE THE CHECK ABOVE CANNOT CLOSE ─────────────────────────────────
   * The check in `record` and this insert are two statements. Two imports of
   * one document running at the same moment — the IMAP scan and a manual
   * upload, or a retry overlapping the first attempt — can both find nothing
   * and both insert. The unique `(trip_id, cc_number)` lets exactly one of them
   * through; the other is refused with P2002.
   *
   * That refusal is the duplicate case, so it is answered as such — but only
   * when it is PROVEN: the violated constraint must be this one, and the row
   * that won must be read back for this Trip and this number. Any other unique
   * conflict, any other database error, and a winner that cannot be found are
   * rethrown unchanged; nothing is reported as recorded that is not.
   *
   * The insert is a single statement outside any transaction, so its refusal
   * leaves nothing half-written and needs no rollback.
   * ──────────────────────────────────────────────────────────────────────────
   */
  private async insertUnlessRecordedConcurrently(
    command: RecordCostConfirmationCommand,
  ): Promise<
    | { readonly outcome: "RECORDED"; readonly confirmation: CostConfirmation }
    | { readonly outcome: "ALREADY_RECORDED"; readonly confirmation: CostConfirmation }
  > {
    try {
      return {
        outcome: "RECORDED",
        confirmation: await this.repository.create({
          tripId: command.tripId,
          pdfDocumentId: command.pdfDocumentId,
          ccNumber: command.ccNumber,
          costCode: command.costCode,
          amount: command.amount,
          currency: command.currency,
          receivedAt: command.receivedAt,
        }),
      };
    } catch (error: unknown) {
      if (!violatesConfirmationIdentity(error)) {
        throw error;
      }

      const winner = (await this.repository.findAllByTrip(command.tripId)).find(
        (confirmation) => confirmation.ccNumber === command.ccNumber,
      );

      if (!winner) {
        this.logger.error(
          "Cost confirmation refused as a duplicate, but no matching row exists",
          { tripId: command.tripId, ccNumber: command.ccNumber },
        );

        throw error;
      }

      this.logger.warn("Cost confirmation recorded concurrently by another import", {
        tripId: command.tripId,
        ccNumber: command.ccNumber,
        recordedConfirmationId: winner.id,
      });

      return { outcome: "ALREADY_RECORDED", confirmation: winner };
    }
  }

  /** The answer for a confirmation the Trip already holds. */
  private alreadyRecorded(
    command: RecordCostConfirmationCommand,
    confirmation: CostConfirmation,
  ): CostConfirmationResult {
    this.logger.log("Cost confirmation already recorded", {
      tripId: command.tripId,
      ccNumber: command.ccNumber,
    });

    return {
      outcome: "ALREADY_RECORDED",
      confirmation,
      // Nothing was written, so nothing can have changed.
      pricing: null,
      reasonCode: null,
    };
  }

  /**
   * Whether this Trip carries the confirmation with this `cc_number`.
   *
   * The question an import asks AFTER `record`, by the same identity `record`
   * deduplicates on: one Trip, one number. A Trip with several different
   * confirmations is checked for the one that was just offered.
   */
  async isRecordedFor(tripId: string, ccNumber: string): Promise<boolean> {
    const recorded = await this.repository.findAllByTrip(tripId);

    return recorded.some((confirmation) => confirmation.ccNumber === ccNumber);
  }

  /**
   * The LATEST confirmation of each Trip on a page, keyed by Trip id.
   *
   * ── WHY THE LATEST AND NOT ALL OF THEM ──────────────────────────────────
   * This feeds the Ritten row, which shows one confirmation and opens its PDF.
   * Returning every confirmation of every Trip would grow the list payload for
   * a history nothing on that screen reads. The older ones are not lost — they
   * are rows like any other, and pricing reads all of them.
   *
   * Still ONE query for the page. The rows arrive newest first, so the first
   * one seen for a Trip is its latest and the rest are stepped over.
   */
  async findForTrips(
    tripIds: readonly string[],
  ): Promise<Map<string, CostConfirmationDto>> {
    const byTrip = new Map<string, CostConfirmationDto>();

    for (const row of await this.repository.findForTrips(tripIds)) {
      if (!byTrip.has(row.tripId)) {
        byTrip.set(row.tripId, toResponse(row));
      }
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
