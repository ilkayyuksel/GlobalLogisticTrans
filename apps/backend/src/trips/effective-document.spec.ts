import { TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { TripDocumentsService } from "./trip-documents.service";
import { TripHistoryEvent } from "./trip-history";
import { TripRepository } from "./trip.repository";

const TRIP_ID = "trip-1";

/**
 * Which document currently governs a Trip.
 *
 * ── WHY THIS IS NOT "THE LAST ROW WRITTEN" ──────────────────────────────────
 * Documents do not arrive in the order they were sent. A CANCEL posted at 09:01
 * can be fetched before the UPDATE posted at 09:00 — a retry, a restart, a slow
 * poll, a mailbox that returns messages out of order — and processing time then
 * says the opposite of what the sender did.
 *
 * So the order is the one the MAIL SERVER recorded: `imported_email.received_at`,
 * the moment the message was accepted. A document uploaded by hand has no email
 * and falls back to its upload time, which for that document is the same fact:
 * when it reached us.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Exactly one document is effective, and only an APPLIED transport document can
 * be: a refused one changed nothing, and a Cost Confirmation carries money
 * rather than transport data.
 */
describe("the effective document of a Trip", () => {
  interface Row {
    eventType: string;
    occurredAt: Date;
    description: string | null;
    newValue: unknown;
    pdfDocument: {
      id: string;
      originalFilename: string;
      uploadedAt: Date;
      importedEmail: { receivedAt: Date } | null;
    } | null;
  }

  let history: Row[];
  let service: TripDocumentsService;

  beforeEach(() => {
    history = [];

    const repository = {
      findById: jest.fn().mockResolvedValue({
        id: TRIP_ID,
        status: TripStatus.OPEN,
        pdfDocumentId: null,
      }),
      // Newest first by processing time, exactly as the real query returns it.
      findHistoryForTrip: jest.fn(() =>
        Promise.resolve(
          [...history].sort(
            (left, right) => right.occurredAt.getTime() - left.occurredAt.getTime(),
          ),
        ),
      ),
      findPdfDocument: jest.fn().mockResolvedValue(null),
    } as unknown as TripRepository;

    service = new TripDocumentsService(repository, {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as AppLoggerService);
  });

  /**
   * One document, with the two timestamps kept apart on purpose: `processedAt`
   * is when we got round to it, `receivedAt` is when the sender's message
   * arrived. The tests below make them disagree.
   */
  function given(
    id: string,
    eventType: string,
    times: { processedAt: string; receivedAt?: string; uploadedAt?: string },
  ): void {
    history.push({
      eventType,
      occurredAt: new Date(times.processedAt),
      description: null,
      newValue: null,
      pdfDocument: {
        id,
        originalFilename: `${id}.pdf`,
        uploadedAt: new Date(times.uploadedAt ?? times.processedAt),
        importedEmail: times.receivedAt
          ? { receivedAt: new Date(times.receivedAt) }
          : null,
      },
    });
  }

  async function effective(): Promise<string | undefined> {
    const { items } = await service.findForTrip(TRIP_ID);

    return items.find((item) => item.isEffective)?.pdfDocumentId;
  }

  it("is the only one marked", async () => {
    given("new-1", TripHistoryEvent.UpdateCreatedTrip, {
      processedAt: "2026-08-20T09:00:00Z",
      receivedAt: "2026-08-20T08:00:00Z",
    });
    given("update-1", TripHistoryEvent.UpdateApplied, {
      processedAt: "2026-08-20T10:00:00Z",
      receivedAt: "2026-08-20T09:00:00Z",
    });

    const { items } = await service.findForTrip(TRIP_ID);

    expect(items.filter((item) => item.isEffective)).toHaveLength(1);
  });

  it("is the latest document by the time the mail server accepted it", async () => {
    given("update-1", TripHistoryEvent.UpdateApplied, {
      processedAt: "2026-08-20T09:00:00Z",
      receivedAt: "2026-08-20T08:00:00Z",
    });
    given("cancel-1", TripHistoryEvent.Cancelled, {
      processedAt: "2026-08-20T10:00:00Z",
      receivedAt: "2026-08-20T09:00:00Z",
    });

    expect(await effective()).toBe("cancel-1");
  });

  /**
   * The case the whole rule exists for: the cancellation was SENT first and
   * processed second. Processing order would call it the latest word; the
   * sender's order says the update is.
   */
  it("follows the sender's order, not the order we processed them in", async () => {
    given("cancel-1", TripHistoryEvent.Cancelled, {
      processedAt: "2026-08-20T12:00:00Z",
      receivedAt: "2026-08-20T08:00:00Z",
    });
    given("update-1", TripHistoryEvent.UpdateApplied, {
      processedAt: "2026-08-20T09:00:00Z",
      receivedAt: "2026-08-20T11:00:00Z",
    });

    expect(await effective()).toBe("update-1");
  });

  it("falls back to the upload time for a document with no email", async () => {
    given("mail-1", TripHistoryEvent.UpdateApplied, {
      processedAt: "2026-08-20T09:00:00Z",
      receivedAt: "2026-08-20T08:00:00Z",
    });
    given("uploaded-1", TripHistoryEvent.Cancelled, {
      processedAt: "2026-08-20T09:30:00Z",
      uploadedAt: "2026-08-20T10:00:00Z",
    });

    expect(await effective()).toBe("uploaded-1");
  });

  it("reports the arrival time it used", async () => {
    given("mail-1", TripHistoryEvent.UpdateApplied, {
      processedAt: "2026-08-20T09:00:00Z",
      receivedAt: "2026-08-20T08:00:00Z",
    });
    given("uploaded-1", TripHistoryEvent.Cancelled, {
      processedAt: "2026-08-20T09:30:00Z",
      uploadedAt: "2026-08-20T10:00:00Z",
    });

    const { items } = await service.findForTrip(TRIP_ID);
    const byId = new Map(items.map((item) => [item.pdfDocumentId, item]));

    expect(byId.get("mail-1")?.receivedAt).toEqual(
      new Date("2026-08-20T08:00:00Z"),
    );
    // No email, so nothing to report: the upload time is `occurredAt`.
    expect(byId.get("uploaded-1")?.receivedAt).toBeNull();
  });

  describe("what can never be the effective document", () => {
    it("a refused document", async () => {
      given("update-1", TripHistoryEvent.UpdateApplied, {
        processedAt: "2026-08-20T09:00:00Z",
        receivedAt: "2026-08-20T08:00:00Z",
      });
      given("refused-1", TripHistoryEvent.UpdateRefused, {
        processedAt: "2026-08-20T10:00:00Z",
        receivedAt: "2026-08-20T09:00:00Z",
      });

      expect(await effective()).toBe("update-1");
    });

    it("a repeated cancellation that changed nothing", async () => {
      given("cancel-1", TripHistoryEvent.Cancelled, {
        processedAt: "2026-08-20T09:00:00Z",
        receivedAt: "2026-08-20T08:00:00Z",
      });
      given("cancel-2", TripHistoryEvent.CancelRedundant, {
        processedAt: "2026-08-20T10:00:00Z",
        receivedAt: "2026-08-20T09:00:00Z",
      });

      expect(await effective()).toBe("cancel-1");
    });

    /** Money, not transport data. It decides nothing about the Trip. */
    it("a cost confirmation, however late it arrives", async () => {
      given("update-1", TripHistoryEvent.UpdateApplied, {
        processedAt: "2026-08-20T09:00:00Z",
        receivedAt: "2026-08-20T08:00:00Z",
      });
      given("cc-1", TripHistoryEvent.CostConfirmed, {
        processedAt: "2026-08-20T10:00:00Z",
        receivedAt: "2026-08-25T09:00:00Z",
      });

      expect(await effective()).toBe("update-1");
    });

    it("nothing at all, when no document was ever applied", async () => {
      given("refused-1", TripHistoryEvent.UpdateRefused, {
        processedAt: "2026-08-20T10:00:00Z",
        receivedAt: "2026-08-20T09:00:00Z",
      });

      expect(await effective()).toBeUndefined();
    });
  });

  /** A NEW that restated an order is applied, and can govern the Trip. */
  it("can be a NEW that was re-applied to an existing Trip", async () => {
    given("update-1", TripHistoryEvent.UpdateApplied, {
      processedAt: "2026-08-20T09:00:00Z",
      receivedAt: "2026-08-20T08:00:00Z",
    });
    given("new-2", TripHistoryEvent.NewReapplied, {
      processedAt: "2026-08-20T10:00:00Z",
      receivedAt: "2026-08-20T09:00:00Z",
    });

    expect(await effective()).toBe("new-2");
  });

  /**
   * The reopening is recorded beside the document that caused it, so it must
   * not appear as a second arrival of the same PDF.
   */
  it("lists a reopening document once", async () => {
    given("update-1", TripHistoryEvent.Reopened, {
      processedAt: "2026-08-20T10:00:00Z",
      receivedAt: "2026-08-20T09:00:00Z",
    });
    given("update-1", TripHistoryEvent.UpdateApplied, {
      processedAt: "2026-08-20T10:00:01Z",
      receivedAt: "2026-08-20T09:00:00Z",
    });

    const { items } = await service.findForTrip(TRIP_ID);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      pdfDocumentId: "update-1",
      action: "UPDATE",
      isEffective: true,
    });
  });
});
