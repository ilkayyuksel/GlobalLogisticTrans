import { TripDirection, TripStatus } from "@prisma/client";

import { toTripResponse } from "./dto/trip-response.dto";

/**
 * A Trip's direction: which half of the transport it is.
 *
 * ── WHY IT IS A COLUMN AND NOT METADATA ─────────────────────────────────────
 * The parser has always read it from the document — a transport order states a
 * LOADING or a DELIVERY section — but it survived only inside
 * `parser_metadata`, which is evidence and which no business decision may read.
 *
 * The Combination export has to label a leg's start and end points by it. That
 * is a business decision, so the value had to become business data. Nothing
 * infers it: not from the date, not from the row order, not from the terminal,
 * not from the booking number.
 * ────────────────────────────────────────────────────────────────────────────
 */
function buildTrip(direction: TripDirection | null) {
  return {
    id: "trip-1",
    pdfDocumentId: "pdf-1",
    tripGroupId: null,
    vehicleId: null,
    driverId: null,
    driverSource: null,
    status: TripStatus.OPEN,
    isLooseTrip: false,
    isPaid: false,
    direction,
    bookingNumber: "ANRDUB2602247",
    containerNumber: null,
    containerType: "45PH",
    terminal: "Quay 869",
    destinationCity: "Gent",
    destinationCountry: "Belgium",
    originalPlanningDate: new Date("2026-06-29T00:00:00.000Z"),
    planningDate: new Date("2026-06-29T00:00:00.000Z"),
    startTime: null,
    endTime: null,
    executionDatetime: null,
    waitingTimeStart: null,
    waitingTimeEnd: null,
    waitingTimeEndsNextDay: false,
    waitingTimeMinutes: null,
    distanceKm: null,
    tarNummer: null,
    internalNotes: null,
    parserMetadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const NO_PLANNING = {
  vehicle: null,
  effectiveDriver: null,
  latestUpdate: null,
  costConfirmation: null,
  costConfirmations: [],
  costConfirmationTotal: null,
  customProperties: [],
  pricing: null,
};

describe("Trip direction", () => {
  it.each([TripDirection.COLLECTION, TripDirection.DELIVERY])(
    "reports %s as the document stated it",
    (direction) => {
      expect(toTripResponse(buildTrip(direction), NO_PLANNING).direction).toBe(
        direction,
      );
    },
  );

  /**
   * A Trip created by hand has no document to have said which half it is, and
   * a Trip imported before this column existed never recorded one. Both are
   * null, and null means "not stated" — never a default worth guessing at.
   */
  it("reports null when nothing stated it", () => {
    expect(toTripResponse(buildTrip(null), NO_PLANNING).direction).toBeNull();
  });

  it("is exposed on the Trip response, so an export can read it", () => {
    const response = toTripResponse(
      buildTrip(TripDirection.DELIVERY),
      NO_PLANNING,
    );

    expect(response).toHaveProperty("direction");
    expect(Object.keys(response)).toContain("direction");
  });

  /**
   * `parserMetadata` stays what it was — evidence — and is still not exposed.
   * The direction is now available WITHOUT reading it.
   */
  it("does not expose the parser's metadata to get there", () => {
    const response = toTripResponse(
      buildTrip(TripDirection.COLLECTION),
      NO_PLANNING,
    );

    expect(response).not.toHaveProperty("parserMetadata");
  });
});

/**
 * Whether the Trip's confirmations count in EK is the backend's answer, read
 * off the price it holds by the Engine's own comparison (`ekSourceOf`): the
 * higher of the waiting time and the confirmations is the EK (owner, November
 * 2026). Merely recording a waiting time no longer decides.
 */
describe("whether the waiting time is the EK rather than the confirmations", () => {
  const pricedWith = (waitingTime: string | null, confirmations: string | null) => ({
    ...NO_PLANNING,
    pricing: {
      components: [
        ...(waitingTime === null ? [] : [{ componentCode: "WAITING_TIME", effectiveAmount: waitingTime }]),
        ...(confirmations === null ? [] : [{ componentCode: "COST_CONFIRMATION", effectiveAmount: confirmations }]),
      ],
    } as unknown as typeof NO_PLANNING.pricing,
  });
  const supersedes = (planning: typeof NO_PLANNING) =>
    toTripResponse(buildTrip(TripDirection.COLLECTION), planning).waitingTimeSupersedesCostConfirmations;

  it("is false for a Trip without a price", () => {
    expect(supersedes(NO_PLANNING)).toBe(false);
  });

  it.each([
    ["the waiting time higher (confirmations stored at €0)", "150.00", "0.00", true],
    ["the waiting time without confirmations", "68.75", null, true],
    ["equal amounts (one stored at €0)", "55.00", "0.00", true],
    ["the confirmations higher (waiting time stored at €0)", "0.00", "138.75", false],
    ["a waiting time priced at €0", "0.00", "68.75", false],
    ["confirmations only", null, "68.75", false],
    ["an older snapshot carrying both, the confirmations higher", "55.00", "138.75", false],
  ])("%s", (_label, waitingTime, confirmations, expected) => {
    expect(supersedes(pricedWith(waitingTime, confirmations))).toBe(expected);
  });
});
