import { Injectable } from "@nestjs/common";

import { AppLoggerService } from "../../logger/app-logger.service";
import type { InvoicePaymentResultDto } from "../dto/invoice-payment.dto";
import { PaymentSelectionNoLongerEligibleException } from "../exceptions/invoice-audit.exceptions";
import { toMarkedRowNumbers } from "../invoice-corrections";
import { InvoiceAuditService } from "../invoice-audit.service";
import type { UploadedInvoiceFile } from "../invoice-examination.service";
import { InvoicePaymentRepository } from "./invoice-payment.repository";
import { assessInvoicePayments } from "./invoice-payments";
import { NotPayableReason, type TripPayment } from "./payment-eligibility";

/** Why a selected Trip is refused, in the words the refusal shows. */
const REFUSAL_WORDS: Record<NotPayableReason | "NOT_ON_INVOICE", string> = {
  NOT_ON_INVOICE: "staat niet op deze factuur",
  [NotPayableReason.NOT_CLOSED]: "rit niet afgesloten",
  [NotPayableReason.NO_OWN_LINE]: "alleen EC-regels",
  [NotPayableReason.NOT_ADDED]: "niet aan de factuur toegevoegd, de totalen wijken af",
  [NotPayableReason.LINE_MARKED]: "regel geel gemarkeerd",
  [NotPayableReason.PRICE_NOT_SETTLED]: "prijs niet betrouwbaar gecontroleerd",
  [NotPayableReason.AMBIGUOUS_MATCH]: "een regel kan meerdere ritten zijn",
  [NotPayableReason.MATCH_CONFLICT]: "twee regels verwijzen naar deze rit",
  [NotPayableReason.BLOCKED_BY_UNRESOLVED_LINE]: "niet toegevoegd, een onopgeloste regel kan deze rit zijn",
};

/**
 * The operator's confirmation that the transports they chose are paid.
 *
 * ── NOTHING FROM THE PREVIEW IS TRUSTED ─────────────────────────────────────
 * The original document comes up again with the chosen Trip ids, and the
 * document is examined AGAIN against what this system holds now — and its
 * correction produced and verified again, so an invoice whose corrected file
 * would be refused cannot be settled either. Only a Trip
 * that is payable on that fresh examination may be paid; if a single chosen id
 * is not — reopened, repriced, under review since, or never on this invoice —
 * the whole request is refused and nothing is paid.
 *
 * ── AND PAID ONCE ───────────────────────────────────────────────────────────
 * A chosen Trip already paid is accepted and left as it is, so confirming twice
 * changes nothing the second time. The rest are paid in one transaction — see
 * `InvoicePaymentRepository`.
 */
@Injectable()
export class InvoicePaymentService {
  constructor(
    private readonly invoices: InvoiceAuditService,
    private readonly payments: InvoicePaymentRepository,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(InvoicePaymentService.name);
  }

  async confirm(
    file: UploadedInvoiceFile | undefined,
    selectedTripIds: readonly string[],
  ): Promise<InvoicePaymentResultDto> {
    /*
     * The corrected document is produced and verified first: an invoice whose
     * correction does not match its plan settles nothing.
     */
    const { examined } = await this.invoices.produce(file);
    const assessed = new Map(
      assessInvoicePayments(
        examined,
        new Set(toMarkedRowNumbers(examined.matches, examined.pricing)),
      ).map((payment) => [payment.trip.id, payment]),
    );
    const refused = toRefusals(selectedTripIds, assessed);

    if (refused.length > 0) {
      this.logger.warn("Invoice payment refused: selection no longer eligible", {
        fileName: examined.fileName,
        selected: selectedTripIds.length,
        refused,
      });

      throw new PaymentSelectionNoLongerEligibleException(refused);
    }

    const toPay = selectedTripIds.filter((tripId) => !assessed.get(tripId)!.alreadyPaid);
    const paidTrips = await this.payments.settle(toPay);
    const alreadyPaid = selectedTripIds.length - toPay.length;

    // Identifiers and counts only: what a transport costs stays out of the log.
    this.logger.log("Invoice payment confirmed", {
      fileName: examined.fileName,
      paidTrips,
      alreadyPaid,
      paidTripIds: toPay,
    });

    return { paidTrips, alreadyPaid, paidTripIds: [...toPay] };
  }
}

function toRefusals(
  selectedTripIds: readonly string[],
  assessed: ReadonlyMap<string, TripPayment>,
): { trip: string; reasons: string[] }[] {
  return selectedTripIds.flatMap((tripId) => {
    const payment = assessed.get(tripId);

    if (payment === undefined) {
      return [{ trip: tripId, reasons: [REFUSAL_WORDS.NOT_ON_INVOICE] }];
    }

    return payment.payable
      ? []
      : [
          {
            trip: payment.trip.bookingNumber ?? tripId,
            reasons: payment.reasons.map((reason) => REFUSAL_WORDS[reason]),
          },
        ];
  });
}
