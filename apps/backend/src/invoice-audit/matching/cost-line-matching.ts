import { Trip, TripStatus } from "@prisma/client";
import { normalizeContainerNumber } from "@tms/parser";

import type { InvoiceCostConfirmation } from "../invoice-audit-read.repository";
import type { InvoiceSheetRow } from "../workbook/invoice-sheet";
import type { IdentifiedTransport } from "./cost-line-transport";
import { InvoiceRowStatus, type BookingCorrection } from "./invoice-row-match";

/**
 * Which confirmation — and so which Trip — a Cost Confirmation line charges.
 *
 * ── BY ITS OWN NUMBER, CHECKED BY ITS BOOKING ───────────────────────────────
 * The line names its confirmation (`EC 4220981`), and the confirmation names
 * its Trip. That is the identification; the booking the line states must then
 * be the Trip's own, and a container, when the line states one, too. A booking
 * that is not is corrected when the line's container IS the Trip's — the EC
 * number and the container both name it. The date is not compared: a
 * confirmation can be invoiced after its transport ran.
 *
 * Exactly one confirmation, of exactly one Trip, that agrees — or the line is
 * unresolved and a person looks at it. Nothing is guessed from the booking
 * alone.
 */
/** The start of the problem of a line whose confirmation this system does not hold. */
export const NO_CONFIRMATION_FOUND = "Geen kostenbevestiging gevonden voor EC";

export interface CostLineDecision {
  readonly status: InvoiceRowStatus;
  readonly trip: Trip | null;
  readonly candidates: readonly Trip[];
  readonly costConfirmation: InvoiceCostConfirmation | null;
  /** The line's misprinted booking, corrected to its Trip's. */
  readonly bookingCorrection: BookingCorrection | null;
  readonly problem: string | null;
}

/**
 * `transportOf` finds the transport a line is about when its confirmation is
 * unknown (`cost-line-transport.ts`): the line stays unresolved — its EK has no
 * confirmation to be compared with — but it names the transport it is about,
 * and its misprinted booking is corrected.
 */
export function decideCostLine(
  row: InvoiceSheetRow,
  confirmationsByNumber: ReadonlyMap<string, readonly InvoiceCostConfirmation[]>,
  tripsById: ReadonlyMap<string, Trip>,
  transportOf: (row: InvoiceSheetRow) => IdentifiedTransport | null = () => null,
): CostLineDecision {
  const ccNumbers = row.costLine?.ccNumbers ?? [];

  if (ccNumbers.length !== 1) {
    return unresolved(`De regel vermeldt ${ccNumbers.length} EC-nummers in plaats van één.`);
  }

  const ccNumber = ccNumbers[0];
  const confirmations = confirmationsByNumber.get(ccNumber) ?? [];

  if (confirmations.length === 0) {
    const transport = transportOf(row);

    return {
      ...unresolved(`${NO_CONFIRMATION_FOUND} ${ccNumber}.`, transport ? [transport.trip] : []),
      bookingCorrection: transport?.bookingCorrection ?? null,
    };
  }

  const trips = confirmations
    .map((confirmation) => tripsById.get(confirmation.tripId))
    .filter((trip): trip is Trip => trip !== undefined);

  if (confirmations.length > 1) {
    return unresolved(`Kostenbevestiging EC ${ccNumber} hoort bij meerdere ritten.`, trips);
  }

  const trip = trips[0];

  if (trip === undefined) {
    return unresolved(`De rit van kostenbevestiging EC ${ccNumber} bestaat niet meer.`);
  }

  /*
   * A misprinted booking is corrected when the line's own container is the
   * confirmation's Trip's: the EC number and the container both name it.
   */
  const bookingCorrection =
    trip.bookingNumber !== row.bookingNumber && trip.bookingNumber && holdsLineContainer(row, trip)
      ? { invoiceBookingNumber: row.bookingNumber, tripBookingNumber: trip.bookingNumber }
      : null;

  if (trip.bookingNumber !== row.bookingNumber && bookingCorrection === null) {
    return unresolved(
      `Kostenbevestiging EC ${ccNumber} hoort bij een rit met boekingsnummer ${trip.bookingNumber ?? "(geen)"}.`,
      [trip],
    );
  }

  if (
    row.normalizedContainerNumber !== "" &&
    normalizeContainerNumber(trip.containerNumber) !== row.normalizedContainerNumber
  ) {
    return unresolved(`Kostenbevestiging EC ${ccNumber} hoort bij een rit met een ander containernummer.`, [trip]);
  }

  if (trip.status !== TripStatus.CLOSED) {
    return unresolved(`De rit van kostenbevestiging EC ${ccNumber} is niet afgewerkt.`, [trip]);
  }

  return {
    status: InvoiceRowStatus.COST_LINE,
    trip,
    candidates: [trip],
    costConfirmation: confirmations[0],
    bookingCorrection,
    problem: null,
  };
}

function holdsLineContainer(row: InvoiceSheetRow, trip: Trip): boolean {
  return (
    row.normalizedContainerNumber !== "" &&
    normalizeContainerNumber(trip.containerNumber) === row.normalizedContainerNumber
  );
}

function unresolved(problem: string, candidates: readonly Trip[] = []): CostLineDecision {
  return {
    status: InvoiceRowStatus.COST_LINE_UNRESOLVED,
    trip: null,
    candidates,
    costConfirmation: null,
    bookingCorrection: null,
    problem,
  };
}
