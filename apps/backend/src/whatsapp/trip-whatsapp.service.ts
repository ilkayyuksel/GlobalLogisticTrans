import { Inject, Injectable } from "@nestjs/common";
import { TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { PdfDocumentService } from "../pdf-documents/pdf-document.service";
import { PdfContentMissingException } from "../pdf-documents/exceptions/pdf-document.exceptions";
import { TripDocumentsService } from "../trips/trip-documents.service";
import { TripService } from "../trips/trip.service";
import type { TripResponseDto } from "../trips/dto/trip-response.dto";
import { DriverService } from "../drivers/driver.service";
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
import { selectTransportDocument } from "./transport-document-selection";
import {
  PhoneNumberRefusal,
  toWhatsAppNumber,
} from "./whatsapp-phone-number";
import {
  SendFailure,
  WHATSAPP_SENDER,
  WhatsAppStatus,
  type WhatsAppPairing,
  type WhatsAppSender,
} from "./whatsapp-sender";

/**
 * Sending a Trip's transport order to its driver over WhatsApp.
 *
 * ── THE WHOLE OF THE DOMAIN DECISION LIVES HERE ─────────────────────────────
 * Who to send to, what to send, and whether to send at all. Each answer is
 * derived from the database rather than from the request: the caller names a
 * Trip and nothing else, so no client can address an arbitrary phone number or
 * name an arbitrary file. That is why there is no generic "send a WhatsApp
 * message" endpoint anywhere in this system.
 *
 * ── SENDING CHANGES NOTHING ─────────────────────────────────────────────────
 * Not the status, not the driver, not the vehicle, not the planning date, not
 * the document history, not the pricing, not the waiting time. This service
 * performs no write of any kind — it reads three things and calls a transport.
 * A failed send therefore cannot corrupt a Trip, because a successful one does
 * not touch it either.
 *
 * ── AND NOTHING SENDS BY ITSELF ─────────────────────────────────────────────
 * There is no hook here for an arriving NEW or UPDATE, for a Trip being created
 * or for a driver changing. An operator presses a button; that is the only
 * trigger, deliberately, because a document that reaches a driver is a
 * commitment and a person should make it.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * The statuses a transport order may be sent for.
 *
 * OPEN is the ordinary case. CLOSED is allowed because the transport happened:
 * re-sending the order a driver already worked from costs nothing and is
 * occasionally exactly what is asked for.
 *
 * CANCELLED is NOT here. The transport was called off, and the backend's own
 * state machine says the only way out of CANCELLED is back to OPEN — so putting
 * the order in a driver's hands would announce that it is happening again,
 * without anyone having decided that. It is reopened first, deliberately.
 * DELETED is out of the planning altogether.
 */
const SENDABLE_STATUSES: readonly TripStatus[] = [
  TripStatus.OPEN,
  TripStatus.CLOSED,
];

/** What the operator is told after a successful send. */
export interface SendPdfResult {
  readonly delivered: true;
  readonly driverName: string;
  readonly filename: string;
}

@Injectable()
export class TripWhatsAppService {
  constructor(
    private readonly tripService: TripService,
    private readonly driverService: DriverService,
    private readonly tripDocuments: TripDocumentsService,
    private readonly pdfDocuments: PdfDocumentService,
    @Inject(WHATSAPP_SENDER) private readonly sender: WhatsAppSender,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(TripWhatsAppService.name);
  }

  status(): Promise<WhatsAppStatus> {
    return this.sender.status();
  }

  /**
   * The pairing state, for the administration screen.
   *
   * A pass-through by design: the decision about whether a QR exists belongs to
   * the connection that issued it, and re-deciding it here would be a second
   * opinion that could disagree.
   */
  pairing(): Promise<WhatsAppPairing> {
    return this.sender.pairing();
  }

  /**
   * Sends the latest applicable transport order to the Trip's effective driver.
   *
   * Every precondition is checked HERE even though the button upstream hides
   * itself when they fail. The frontend's copy of these rules is a convenience;
   * this one is the rule.
   */
  async sendTransportDocument(tripId: string): Promise<SendPdfResult> {
    /*
     * The Trip as the rest of the application reads it, which already carries
     * the resolved effective driver. Going through the repository instead would
     * mean re-deriving that resolution here — a second driver lookup, and
     * eventually a second answer.
     */
    const trip = await this.tripService.findById(tripId);

    if (!SENDABLE_STATUSES.includes(trip.status)) {
      throw new TripCannotSendInStatusException(trip.status);
    }

    const { name: driverName, phoneNumber } = await this.resolveDriver(trip);
    const pdfDocumentId = await this.resolveDocument(tripId, trip.pdfDocumentId);
    const document = await this.readDocument(pdfDocumentId);

    const result = await this.sender.sendDocument({
      phoneNumber,
      filename: document.originalFilename,
      caption: captionFor(trip.bookingNumber),
      content: document.content,
    });

    if (!result.delivered) {
      this.throwFor(result.failure, result.status);
    }

    /*
     * Logged with the Trip and the document, never with the phone number or the
     * driver's contact details: an operational log is read by more people than
     * the Driver screen is.
     */
    this.logger.log("Transport order sent to a driver over WhatsApp", {
      tripId,
      pdfDocumentId,
      driverId: trip.effectiveDriver?.id ?? null,
    });

    return {
      delivered: true,
      driverName,
      filename: document.originalFilename,
    };
  }

  /**
   * The Trip's effective driver and a usable number for them.
   *
   * `effectiveDriver` is already on the Trip, resolved by the one rule the whole
   * application uses: the explicit override when there is one, otherwise the
   * vehicle's assignment for that day. This does not second-guess it — no
   * separate lookup, and never the vehicle's current driver independently of the
   * Trip. Only the phone number is fetched here, by the id that came back.
   */
  private async resolveDriver(
    trip: TripResponseDto,
  ): Promise<{ name: string; phoneNumber: string }> {
    const effectiveDriver = trip.effectiveDriver;

    if (!effectiveDriver) {
      this.logger.warn("A WhatsApp send was refused: the Trip has no driver", {
        tripId: trip.id,
      });

      throw new TripHasNoDriverException();
    }

    const driver = await this.driverService.findById(effectiveDriver.id);
    const { whatsAppNumber, reason } = toWhatsAppNumber(driver.phoneNumber);

    if (reason === PhoneNumberRefusal.MISSING) {
      throw new DriverHasNoPhoneNumberException(effectiveDriver.name);
    }

    if (whatsAppNumber === null) {
      this.logger.warn("A WhatsApp send was refused: unusable phone number", {
        tripId: trip.id,
        driverId: effectiveDriver.id,
        reason,
      });

      throw new UnusablePhoneNumberException(effectiveDriver.name);
    }

    return { name: effectiveDriver.name, phoneNumber: whatsAppNumber };
  }

  /** The latest applied UPDATE, or the original NEW order. Never a CANCEL. */
  private async resolveDocument(
    tripId: string,
    originalPdfDocumentId: string | null,
  ): Promise<string> {
    const { items } = await this.tripDocuments.findForTrip(tripId);
    const { pdfDocumentId } = selectTransportDocument(
      items,
      originalPdfDocumentId,
    );

    if (!pdfDocumentId) {
      throw new TripHasNoTransportDocumentException();
    }

    return pdfDocumentId;
  }

  /**
   * The stored bytes, through the existing content path.
   *
   * No second copy of the PDF is made and no storage path is constructed here:
   * this asks the PdfDocument domain for content by id, exactly as the viewer
   * endpoint does.
   */
  private async readDocument(pdfDocumentId: string) {
    try {
      return await this.pdfDocuments.readContent(pdfDocumentId);
    } catch (error: unknown) {
      if (error instanceof PdfContentMissingException) {
        this.logger.error("A transport order is missing from storage", {
          pdfDocumentId,
        });

        throw new TransportDocumentUnreadableException();
      }

      throw error;
    }
  }

  /**
   * Turns a transport refusal into the sentence an operator reads.
   *
   * Nothing was delivered in any of these branches, and none of them touched
   * the Trip.
   */
  private throwFor(
    failure: SendFailure | null,
    status: WhatsAppStatus,
  ): never {
    if (failure === SendFailure.SEND_FAILED) {
      throw new WhatsAppSendFailedException();
    }

    throw new WhatsAppNotConnectedException(EXPLANATIONS[status]);
  }
}

/**
 * Why WhatsApp is unavailable, in words an operator can act on.
 *
 * PAIRING_REQUIRED is the one that needs a person with a phone, so it says so
 * rather than reporting a generic outage somebody would wait out.
 */
const EXPLANATIONS: Record<WhatsAppStatus, string> = {
  [WhatsAppStatus.CONNECTED]: "WhatsApp reported a problem.",
  [WhatsAppStatus.CONNECTING]: "WhatsApp is still connecting. Try again shortly.",
  [WhatsAppStatus.DISCONNECTED]:
    "WhatsApp is not connected. It reconnects by itself; try again shortly.",
  [WhatsAppStatus.PAIRING_REQUIRED]:
    "WhatsApp is not linked. An administrator has to scan the pairing code again.",
  [WhatsAppStatus.ERROR]: "WhatsApp is unavailable.",
  [WhatsAppStatus.DISABLED]: "WhatsApp is switched off in this environment.",
};

/**
 * The message that travels with the document.
 *
 * Short on purpose, and it names the booking rather than describing the load: a
 * WhatsApp message is not a secure channel, it is read on a lock screen, and the
 * booking number is the one identifier a driver needs to match it to their day.
 * No address, no customer, no price and no container contents.
 */
export function captionFor(bookingNumber: string | null): string {
  return bookingNumber
    ? `TRANO – Transportorder ${bookingNumber}`
    : "TRANO – Transportorder";
}
