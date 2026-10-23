import { Trip, TripStatus } from "@prisma/client";
import { normalizeContainerNumber } from "@tms/parser";

import type { InvoiceCostConfirmation } from "../invoice-audit-read.repository";
import type { InvoiceSheetRow } from "../workbook/invoice-sheet";
import type { IdentifiedTransport } from "./cost-line-transport";
import { InvoiceRowStatus, type BookingCorrection } from "./invoice-row-match";
import { describeTrip } from "./trip-words";

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
  /**
   * The Trip the line's OWN values — date, booking, container — identify,
   * found apart from its confirmation (`cost-line-transport.ts`); null when
   * they identify none, or several.
   */
  readonly transportTrip: Trip | null;
  readonly problem: string | null;
}

/**
 * ── TWO QUESTIONS, ANSWERED APART ───────────────────────────────────────────
 * Which transport the line is about is answered by its date, booking and
 * container alone (`transportOf`) — never by its EC number. Which Trip its EK
 * is checked against is answered by its confirmation. Only when the two agree
 * — or the values identify no Trip — is the EK checked; when they name
 * different Trips, nothing is chosen: the line is unresolved and says both.
 *
 * With its confirmation unknown, the line names the transport its values
 * identify and its misprinted booking is corrected; its EK has nothing to be
 * compared with.
 */
export function decideCostLine(
  row: InvoiceSheetRow,
  confirmationsByNumber: ReadonlyMap<string, readonly InvoiceCostConfirmation[]>,
  tripsById: ReadonlyMap<string, Trip>,
  transportOf: (row: InvoiceSheetRow) => IdentifiedTransport | null = () => null,
): CostLineDecision {
  const transport = transportOf(row);

  return { ...decideOnConfirmation(row, confirmationsByNumber, tripsById, transport), transportTrip: transport?.trip ?? null };
}

function decideOnConfirmation(
  row: InvoiceSheetRow,
  confirmationsByNumber: ReadonlyMap<string, readonly InvoiceCostConfirmation[]>,
  tripsById: ReadonlyMap<string, Trip>,
  transport: IdentifiedTransport | null,
): Omit<CostLineDecision, "transportTrip"> {
  const ccNumbers = row.costLine?.ccNumbers ?? [];

  if (ccNumbers.length !== 1) {
    return unresolved(`De regel vermeldt ${ccNumbers.length} EC-nummers in plaats van één.`);
  }

  const ccNumber = ccNumbers[0];
  const confirmations = confirmationsByNumber.get(ccNumber) ?? [];

  if (confirmations.length === 0) {
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

  if (transport !== null && transport.trip.id !== trip.id) {
    return unresolved(
      `Kostenbevestiging EC ${ccNumber} hoort bij rit ${describeTrip(trip)}, maar de identificatievelden van deze regel (datum, boekingsnummer, container) wijzen rit ${describeTrip(transport.trip)} aan; het EK-bedrag is niet gecontroleerd.`,
      [trip],
    );
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

function unresolved(problem: string, candidates: readonly Trip[] = []): Omit<CostLineDecision, "transportTrip"> {
  return {
    status: InvoiceRowStatus.COST_LINE_UNRESOLVED,
    trip: null,
    candidates,
    costConfirmation: null,
    bookingCorrection: null,
    problem,
  };
}
