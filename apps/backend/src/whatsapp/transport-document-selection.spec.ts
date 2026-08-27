import {
  TripDocumentAction,
  type TripDocumentDto,
} from "../trips/dto/trip-document-response.dto";
import {
  DocumentRefusal,
  selectTransportDocument,
} from "./transport-document-selection";

/**
 * WHICH document a driver is sent.
 *
 * ── WHY THIS IS TESTED SO HEAVILY FOR ITS SIZE ──────────────────────────────
 * Getting it wrong does not throw and does not log. It hands a driver the wrong
 * piece of paper — a cancelled transport, a superseded route, an invoice — and
 * nobody finds out until a truck is somewhere it should not be. So every
 * document type that must NEVER be chosen has a test saying so by name.
 */
const ORIGINAL = "pdf-original";

function document(overrides: Partial<TripDocumentDto> = {}): TripDocumentDto {
  return {
    pdfDocumentId: "pdf-1",
    action: TripDocumentAction.Update,
    originalFilename: "update.pdf",
    occurredAt: new Date("2026-08-20T10:00:00.000Z"),
    receivedAt: new Date("2026-08-20T09:00:00.000Z"),
    changedFields: [],
    outcome: null,
    applied: true,
    createdTrip: false,
    isEffective: false,
    ...overrides,
  };
}

describe("choosing the transport order to send a driver", () => {
  describe("when the Trip has been updated", () => {
    it("chooses the applied UPDATE over the original order", () => {
      const selection = selectTransportDocument(
        [document({ pdfDocumentId: "pdf-update" })],
        ORIGINAL,
      );

      expect(selection.pdfDocumentId).toBe("pdf-update");
    });

    /** Arrival time, not processing order and not the order of the array. */
    it("chooses the latest UPDATE by arrival when several exist", () => {
      const selection = selectTransportDocument(
        [
          document({
            pdfDocumentId: "pdf-first",
            receivedAt: new Date("2026-08-18T08:00:00.000Z"),
          }),
          document({
            pdfDocumentId: "pdf-latest",
            receivedAt: new Date("2026-08-22T08:00:00.000Z"),
          }),
          document({
            pdfDocumentId: "pdf-middle",
            receivedAt: new Date("2026-08-20T08:00:00.000Z"),
          }),
        ],
        ORIGINAL,
      );

      expect(selection.pdfDocumentId).toBe("pdf-latest");
    });

    /** A hand-uploaded document has no email, so its upload time is its arrival. */
    it("falls back to the event time when a document never came by email", () => {
      const selection = selectTransportDocument(
        [
          document({
            pdfDocumentId: "pdf-emailed",
            receivedAt: new Date("2026-08-18T08:00:00.000Z"),
          }),
          document({
            pdfDocumentId: "pdf-uploaded",
            receivedAt: null,
            occurredAt: new Date("2026-08-25T08:00:00.000Z"),
          }),
        ],
        ORIGINAL,
      );

      expect(selection.pdfDocumentId).toBe("pdf-uploaded");
    });

    /**
     * A refused UPDATE moved nothing, so the Trip does not reflect it. Sending
     * it would hand a driver a document that disagrees with their own planning.
     */
    it("never chooses a refused UPDATE", () => {
      const selection = selectTransportDocument(
        [
          document({
            pdfDocumentId: "pdf-refused",
            applied: false,
            receivedAt: new Date("2026-08-26T08:00:00.000Z"),
          }),
          document({
            pdfDocumentId: "pdf-applied",
            applied: true,
            receivedAt: new Date("2026-08-20T08:00:00.000Z"),
          }),
        ],
        ORIGINAL,
      );

      expect(selection.pdfDocumentId).toBe("pdf-applied");
    });

    it("falls back to the original order when every UPDATE was refused", () => {
      const selection = selectTransportDocument(
        [document({ pdfDocumentId: "pdf-refused", applied: false })],
        ORIGINAL,
      );

      expect(selection.pdfDocumentId).toBe(ORIGINAL);
    });
  });

  describe("the documents that are never sent", () => {
    /** A cancellation is the opposite of the instruction a driver needs. */
    it("never chooses a CANCEL, even as the newest applied document", () => {
      const selection = selectTransportDocument(
        [
          document({
            pdfDocumentId: "pdf-cancel",
            action: TripDocumentAction.Cancel,
            applied: true,
            receivedAt: new Date("2026-08-27T08:00:00.000Z"),
          }),
          document({
            pdfDocumentId: "pdf-update",
            receivedAt: new Date("2026-08-20T08:00:00.000Z"),
          }),
        ],
        ORIGINAL,
      );

      expect(selection.pdfDocumentId).toBe("pdf-update");
    });

    /** Money between Eucon and the office; no transport data, not the driver's. */
    it("never chooses a COST CONFIRMATION", () => {
      const selection = selectTransportDocument(
        [
          document({
            pdfDocumentId: "pdf-cost",
            action: TripDocumentAction.CostConfirmation,
            applied: true,
            receivedAt: new Date("2026-08-27T08:00:00.000Z"),
          }),
        ],
        ORIGINAL,
      );

      expect(selection.pdfDocumentId).toBe(ORIGINAL);
    });

    /**
     * A CANCEL can be the document that GOVERNS the Trip. The effective marker
     * answers "what governs this"; this answers "what may a driver drive from",
     * and on a cancelled Trip those are different documents.
     */
    it("does not simply follow the effective marker", () => {
      const selection = selectTransportDocument(
        [
          document({
            pdfDocumentId: "pdf-cancel",
            action: TripDocumentAction.Cancel,
            applied: true,
            isEffective: true,
            receivedAt: new Date("2026-08-27T08:00:00.000Z"),
          }),
        ],
        ORIGINAL,
      );

      expect(selection.pdfDocumentId).toBe(ORIGINAL);
    });
  });

  describe("when the Trip has never been updated", () => {
    it("chooses the original NEW order", () => {
      expect(selectTransportDocument([], ORIGINAL).pdfDocumentId).toBe(ORIGINAL);
    });

    /** A Trip created by hand has no document at all, and none is invented. */
    it("refuses when there is no document of any kind", () => {
      const selection = selectTransportDocument([], null);

      expect(selection).toEqual({
        pdfDocumentId: null,
        reason: DocumentRefusal.NO_TRANSPORT_DOCUMENT,
      });
    });

    it("refuses when a hand-made Trip has only a cost confirmation", () => {
      const selection = selectTransportDocument(
        [
          document({
            action: TripDocumentAction.CostConfirmation,
            applied: true,
          }),
        ],
        null,
      );

      expect(selection.reason).toBe(DocumentRefusal.NO_TRANSPORT_DOCUMENT);
    });
  });

  /** Two documents sharing an arrival time is unresolvable; be stable, not random. */
  it("gives the same answer every time when two UPDATEs tie", () => {
    const tied = [
      document({
        pdfDocumentId: "pdf-a",
        receivedAt: new Date("2026-08-20T08:00:00.000Z"),
      }),
      document({
        pdfDocumentId: "pdf-b",
        receivedAt: new Date("2026-08-20T08:00:00.000Z"),
      }),
    ];

    expect(selectTransportDocument(tied, ORIGINAL).pdfDocumentId).toBe("pdf-a");
    expect(selectTransportDocument(tied, ORIGINAL).pdfDocumentId).toBe("pdf-a");
  });
});
