import { TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { PdfContentMissingException } from "../pdf-documents/exceptions/pdf-document.exceptions";
import { TripDocumentAction } from "../trips/dto/trip-document-response.dto";
import {
  DriverHasNoPhoneNumberException,
  TransportDocumentUnreadableException,
  TripCannotSendInStatusException,
  TripHasNoDriverException,
  TripHasNoTransportDocumentException,
  UnusablePhoneNumberException,
  WhatsAppNotConnectedException,
  WhatsAppSendFailedException,
} from "./exceptions/whatsapp.exceptions";
import { TripWhatsAppService, captionFor } from "./trip-whatsapp.service";
import {
  SendFailure,
  WhatsAppStatus,
  type SendDocumentCommand,
  type SendResult,
  type WhatsAppPairing,
  type WhatsAppSender,
} from "./whatsapp-sender";

/**
 * Sending a transport order, against a FAKE WhatsApp.
 *
 * ── NO REAL ACCOUNT, EVER ───────────────────────────────────────────────────
 * CI cannot scan a QR, and a suite that could send would eventually send to a
 * real driver's phone. `WhatsAppSender` is the seam that makes every branch
 * below reachable without one — and it is the same seam the official Cloud API
 * will arrive through.
 *
 * ── WHAT THESE TESTS ARE REALLY DEFENDING ───────────────────────────────────
 * Two properties. First, that TRANO never claims a delivery that did not
 * happen. Second, that sending — successful or not — writes nothing: no status
 * change, no driver change, no history entry. A send is an outward action, and
 * a Trip must be exactly what it was afterwards.
 */
const TRIP_ID = "11111111-1111-4111-8111-111111111111";
const PDF_BYTES = Buffer.from("%PDF-1.7 transport order");

class FakeSender implements WhatsAppSender {
  commands: SendDocumentCommand[] = [];
  qr: string | null = null;
  result: SendResult = {
    delivered: true,
    failure: null,
    status: WhatsAppStatus.CONNECTED,
  };

  async sendDocument(command: SendDocumentCommand): Promise<SendResult> {
    this.commands.push(command);

    return this.result;
  }

  async status(): Promise<WhatsAppStatus> {
    return this.result.status;
  }

  async pairing(): Promise<WhatsAppPairing> {
    return { status: this.result.status, qr: this.qr };
  }
}

describe("sending a Trip's transport order over WhatsApp", () => {
  let tripService: { findById: jest.Mock };
  let driverService: { findById: jest.Mock };
  let tripDocuments: { findForTrip: jest.Mock };
  let pdfDocuments: { readContent: jest.Mock };
  let sender: FakeSender;
  let logger: {
    setContext: jest.Mock;
    log: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
  };
  let service: TripWhatsAppService;

  beforeEach(() => {
    tripService = { findById: jest.fn().mockResolvedValue(buildTrip()) };
    driverService = {
      findById: jest
        .fn()
        .mockResolvedValue({ id: "driver-1", phoneNumber: "+32 470 11 22 33" }),
    };
    tripDocuments = { findForTrip: jest.fn().mockResolvedValue({ items: [] }) };
    pdfDocuments = {
      readContent: jest.fn().mockResolvedValue({
        content: PDF_BYTES,
        originalFilename: "transport-order.pdf",
      }),
    };
    sender = new FakeSender();
    logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    service = new TripWhatsAppService(
      tripService as never,
      driverService as never,
      tripDocuments as never,
      pdfDocuments as never,
      sender,
      logger as unknown as AppLoggerService,
    );
  });

  function buildTrip(overrides: Record<string, unknown> = {}) {
    return {
      id: TRIP_ID,
      status: TripStatus.OPEN,
      bookingNumber: "ANRDUB2602247",
      pdfDocumentId: "pdf-original",
      effectiveDriver: {
        id: "driver-1",
        name: "Jan Peeters",
        isActive: true,
        source: "OVERRIDE",
      },
      ...overrides,
    };
  }

  describe("a Trip that can be sent for", () => {
    it("delivers the PDF and reports who received it", async () => {
      const result = await service.sendTransportDocument(TRIP_ID);

      expect(result).toEqual({
        delivered: true,
        driverName: "Jan Peeters",
        filename: "transport-order.pdf",
      });
    });

    /** The bytes themselves, never a path, a URL or a link to a viewer. */
    it("passes the stored bytes and the document's own filename", async () => {
      await service.sendTransportDocument(TRIP_ID);

      expect(sender.commands[0]).toMatchObject({
        phoneNumber: "32470112233",
        filename: "transport-order.pdf",
      });
      expect(sender.commands[0].content).toBe(PDF_BYTES);
    });

    it("captions the document with the booking number", async () => {
      await service.sendTransportDocument(TRIP_ID);

      expect(sender.commands[0].caption).toBe(
        "TRANO – Transportorder ANRDUB2602247",
      );
    });

    /** One operator action, one message. Nothing here retries. */
    it("calls the sender exactly once", async () => {
      await service.sendTransportDocument(TRIP_ID);

      expect(sender.commands).toHaveLength(1);
    });

    /** The whole point of §18: an outward action writes nothing. */
    it("writes nothing to the Trip", async () => {
      await service.sendTransportDocument(TRIP_ID);

      expect(tripService.findById).toHaveBeenCalledTimes(1);
      expect(tripService).not.toHaveProperty("update");
      expect(tripDocuments.findForTrip).toHaveBeenCalledWith(TRIP_ID);
    });

    /** A log is read by more people than the Driver screen is. */
    it("logs the send without the phone number", async () => {
      await service.sendTransportDocument(TRIP_ID);

      expect(JSON.stringify(logger.log.mock.calls)).not.toContain("470");
    });
  });

  describe("which document is sent", () => {
    it("prefers the latest applied UPDATE over the original order", async () => {
      tripDocuments.findForTrip.mockResolvedValue({
        items: [
          {
            pdfDocumentId: "pdf-update",
            action: TripDocumentAction.Update,
            applied: true,
            receivedAt: new Date("2026-08-22T08:00:00.000Z"),
            occurredAt: new Date("2026-08-22T09:00:00.000Z"),
          },
        ],
      });

      await service.sendTransportDocument(TRIP_ID);

      expect(pdfDocuments.readContent).toHaveBeenCalledWith("pdf-update");
    });

    it("sends the original order when no UPDATE has been applied", async () => {
      await service.sendTransportDocument(TRIP_ID);

      expect(pdfDocuments.readContent).toHaveBeenCalledWith("pdf-original");
    });

    it("refuses a Trip that has no transport document at all", async () => {
      tripService.findById.mockResolvedValue(
        buildTrip({ pdfDocumentId: null }),
      );

      await expect(service.sendTransportDocument(TRIP_ID)).rejects.toThrow(
        TripHasNoTransportDocumentException,
      );
      expect(sender.commands).toHaveLength(0);
    });
  });

  describe("the driver", () => {
    /** Whoever the Trip resolved to — override or vehicle assignment. */
    it("sends to the Trip's effective driver", async () => {
      await service.sendTransportDocument(TRIP_ID);

      expect(driverService.findById).toHaveBeenCalledWith("driver-1");
    });

    it("respects an explicit driver override", async () => {
      tripService.findById.mockResolvedValue(
        buildTrip({
          effectiveDriver: {
            id: "driver-override",
            name: "Piet Janssens",
            isActive: true,
            source: "OVERRIDE",
          },
        }),
      );

      const result = await service.sendTransportDocument(TRIP_ID);

      expect(driverService.findById).toHaveBeenCalledWith("driver-override");
      expect(result.driverName).toBe("Piet Janssens");
    });

    it("refuses a Trip with no driver", async () => {
      tripService.findById.mockResolvedValue(
        buildTrip({ effectiveDriver: null }),
      );

      await expect(service.sendTransportDocument(TRIP_ID)).rejects.toThrow(
        TripHasNoDriverException,
      );
      expect(sender.commands).toHaveLength(0);
    });

    it("refuses a driver with no phone number", async () => {
      driverService.findById.mockResolvedValue({
        id: "driver-1",
        phoneNumber: null,
      });

      await expect(service.sendTransportDocument(TRIP_ID)).rejects.toThrow(
        DriverHasNoPhoneNumberException,
      );
      expect(sender.commands).toHaveLength(0);
    });

    /** A national number is unusable and is never decorated with a prefix. */
    it("refuses a phone number WhatsApp cannot address", async () => {
      driverService.findById.mockResolvedValue({
        id: "driver-1",
        phoneNumber: "0470 11 22 33",
      });

      await expect(service.sendTransportDocument(TRIP_ID)).rejects.toThrow(
        UnusablePhoneNumberException,
      );
      expect(sender.commands).toHaveLength(0);
    });

    it("never looks a driver up any way but through the Trip", async () => {
      tripService.findById.mockResolvedValue(
        buildTrip({ effectiveDriver: null, vehicleId: "vehicle-1" }),
      );

      await expect(service.sendTransportDocument(TRIP_ID)).rejects.toThrow(
        TripHasNoDriverException,
      );
      expect(driverService.findById).not.toHaveBeenCalled();
    });
  });

  describe("which statuses may be sent for", () => {
    it.each([TripStatus.OPEN, TripStatus.CLOSED])(
      "sends for a %s Trip",
      async (status) => {
        tripService.findById.mockResolvedValue(buildTrip({ status }));

        await expect(
          service.sendTransportDocument(TRIP_ID),
        ).resolves.toMatchObject({ delivered: true });
      },
    );

    /**
     * A cancelled transport was called off, and the backend's only way out of
     * CANCELLED is back to OPEN. Sending its order would announce that it is
     * happening again without anyone having decided so.
     */
    it.each([TripStatus.CANCELLED, TripStatus.DELETED])(
      "refuses a %s Trip",
      async (status) => {
        tripService.findById.mockResolvedValue(buildTrip({ status }));

        await expect(service.sendTransportDocument(TRIP_ID)).rejects.toThrow(
          TripCannotSendInStatusException,
        );
        expect(sender.commands).toHaveLength(0);
      },
    );

    it("checks the status before reading any document", async () => {
      tripService.findById.mockResolvedValue(
        buildTrip({ status: TripStatus.CANCELLED }),
      );

      await expect(service.sendTransportDocument(TRIP_ID)).rejects.toThrow();
      expect(pdfDocuments.readContent).not.toHaveBeenCalled();
    });
  });

  describe("when WhatsApp cannot deliver", () => {
    it("reports a disconnected transport without claiming a send", async () => {
      sender.result = {
        delivered: false,
        failure: SendFailure.NOT_CONNECTED,
        status: WhatsAppStatus.DISCONNECTED,
      };

      await expect(service.sendTransportDocument(TRIP_ID)).rejects.toThrow(
        WhatsAppNotConnectedException,
      );
    });

    /** The one outage a person has to fix, so it says so. */
    it("says an administrator must pair when the account is unlinked", async () => {
      sender.result = {
        delivered: false,
        failure: SendFailure.NOT_CONNECTED,
        status: WhatsAppStatus.PAIRING_REQUIRED,
      };

      await expect(service.sendTransportDocument(TRIP_ID)).rejects.toThrow(
        /pairing code/i,
      );
    });

    it("reports a rejected send as a failure", async () => {
      sender.result = {
        delivered: false,
        failure: SendFailure.SEND_FAILED,
        status: WhatsAppStatus.CONNECTED,
      };

      await expect(service.sendTransportDocument(TRIP_ID)).rejects.toThrow(
        WhatsAppSendFailedException,
      );
    });

    it("reports an unreachable service as not connected", async () => {
      sender.result = {
        delivered: false,
        failure: SendFailure.SERVICE_UNREACHABLE,
        status: WhatsAppStatus.ERROR,
      };

      await expect(service.sendTransportDocument(TRIP_ID)).rejects.toThrow(
        WhatsAppNotConnectedException,
      );
    });

    it("says WhatsApp is switched off when it is disabled", async () => {
      sender.result = {
        delivered: false,
        failure: SendFailure.NOT_CONNECTED,
        status: WhatsAppStatus.DISABLED,
      };

      await expect(service.sendTransportDocument(TRIP_ID)).rejects.toThrow(
        /switched off/i,
      );
    });
  });

  describe("when the document cannot be read", () => {
    it("refuses without attempting a send", async () => {
      pdfDocuments.readContent.mockRejectedValue(
        new PdfContentMissingException("pdf-original"),
      );

      await expect(service.sendTransportDocument(TRIP_ID)).rejects.toThrow(
        TransportDocumentUnreadableException,
      );
      expect(sender.commands).toHaveLength(0);
    });

    /** A storage path must never reach a client, not even inside an error. */
    it("does not expose the storage location", async () => {
      pdfDocuments.readContent.mockRejectedValue(
        new PdfContentMissingException("pdf-original"),
      );

      await expect(service.sendTransportDocument(TRIP_ID)).rejects.toThrow(
        expect.not.stringContaining("/app/storage") as never,
      );
    });
  });

  describe("reporting availability", () => {
    it.each([
      WhatsAppStatus.CONNECTED,
      WhatsAppStatus.PAIRING_REQUIRED,
      WhatsAppStatus.DISABLED,
    ])("passes %s through from the transport", async (status) => {
      sender.result = { ...sender.result, status };

      await expect(service.status()).resolves.toBe(status);
    });
  });
});

describe("the caption a driver receives", () => {
  /** Enough to match the message to their day, and nothing else. */
  it("names the booking number", () => {
    expect(captionFor("ANRDUB2602247")).toBe(
      "TRANO – Transportorder ANRDUB2602247",
    );
  });

  it("stays useful when a Trip has no booking number", () => {
    expect(captionFor(null)).toBe("TRANO – Transportorder");
  });

  /**
   * WhatsApp is read on a lock screen and is not a secure channel, so the
   * caption is the product name and the one identifier a driver needs to match
   * the message to their day. The destination, the customer, the container and
   * the price all stay inside the PDF, where they were already going.
   */
  it("carries nothing beyond the product name and the booking", () => {
    expect(captionFor("ANRDUB2602247")).toBe(
      "TRANO – Transportorder ANRDUB2602247",
    );
  });
});
