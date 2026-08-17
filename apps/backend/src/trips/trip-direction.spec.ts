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
    status: TripStatus.OPEN,
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
    waitingTimeMinutes: null,
    distanceKm: null,
    internalNotes: null,
    parserMetadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const NO_PLANNING = {
  vehicle: null,
  effectiveDriver: null,
  customProperties: [],
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
