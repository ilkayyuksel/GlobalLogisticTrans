import type { Trip } from "@/lib/api/types";
import { canEditDestination, canEditDocumentFields } from "./row-actions";

/**
 * Who may type a Trip's destination.
 *
 * ── THE RULE THIS PINS ──────────────────────────────────────────────────────
 * A document owns what it SAYS, not what it never said. Most imported orders
 * name a destination, and that field stays closed — a later UPDATE re-reads it
 * and would overwrite anything typed over it, so the backend refuses the edit
 * and the row must not offer it.
 *
 * But some real orders state no destination at all: the address block holds a
 * postcode, a company and a street and stops. Those import with an empty city,
 * and the operator is then the only possible author of the address. Guarding
 * that emptiness on behalf of a document with no opinion would leave the Trip
 * permanently without one.
 *
 * This mirrors `assertDocumentFieldsEditable` on the backend. The backend
 * decides; this only decides what to put on screen, and the two must agree.
 * ────────────────────────────────────────────────────────────────────────────
 */

function buildTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "trip-1",
    status: "OPEN",
    pdfDocumentId: "pdf-1",
    destinationCity: "Lokeren",
    destinationCountry: "Belgium",
    ...overrides,
  } as unknown as Trip;
}

describe("editing the destination", () => {
  describe("a Trip created by hand", () => {
    const MANUAL = buildTrip({ pdfDocumentId: null });

    it("is editable, as every one of its document fields is", () => {
      expect(canEditDestination(MANUAL)).toBe(true);
      expect(canEditDocumentFields(MANUAL)).toBe(true);
    });

    it("stays editable once it has an address", () => {
      expect(
        canEditDestination(
          buildTrip({ pdfDocumentId: null, destinationCity: "Gent" }),
        ),
      ).toBe(true);
    });
  });

  describe("an imported Trip", () => {
    /** The document named a destination: it owns it. */
    it("is not editable when the document stated one", () => {
      expect(canEditDestination(buildTrip())).toBe(false);
    });

    /**
     * The case this exists for. The order states no place, the parser imported
     * a null city, and somebody has to be able to write the address.
     */
    it("IS editable when the document stated none", () => {
      expect(
        canEditDestination(buildTrip({ destinationCity: null })),
      ).toBe(true);
    });

    /** The wider guard is untouched: this is a destination-only exception. */
    it("still reports its other document fields as closed", () => {
      expect(canEditDocumentFields(buildTrip({ destinationCity: null }))).toBe(
        false,
      );
    });

    /** An empty city with a stated country is still an empty city. */
    it("is editable when only the country was stated", () => {
      expect(
        canEditDestination(
          buildTrip({ destinationCity: null, destinationCountry: "Belgium" }),
        ),
      ).toBe(true);
    });
  });

  /**
   * A DELETED Trip is read-only whatever its origin, and that outranks the
   * emptiness: `canEdit` is the first condition, not an afterthought.
   */
  describe("a DELETED Trip", () => {
    it.each([null, "pdf-1"])(
      "is never editable, pdfDocumentId=%p",
      (pdfDocumentId) => {
        expect(
          canEditDestination(
            buildTrip({
              status: "DELETED",
              pdfDocumentId,
              destinationCity: null,
            }),
          ),
        ).toBe(false);
      },
    );
  });
});
