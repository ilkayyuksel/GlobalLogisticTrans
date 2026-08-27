import {
  BadGatewayException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";

import { TripStatus } from "@prisma/client";

/**
 * Why a WhatsApp send was refused.
 *
 * ── EVERY MESSAGE HERE IS READ BY AN OPERATOR ───────────────────────────────
 * The frontend shows what the backend said, so each of these is a whole
 * sentence about the operational situation — "this driver has no phone number"
 * — and never a status code, a stack, a storage path or the name of a library.
 *
 * ── 422 FOR THE TRIP'S OWN STATE, 503 FOR THE TRANSPORT ─────────────────────
 * A Trip with no driver is a problem with the request that no retry will fix:
 * 422. WhatsApp being down is temporary and the same click will work later:
 * 503. That distinction is what lets a client tell "fix something" from
 * "try again in a minute".
 * ────────────────────────────────────────────────────────────────────────────
 */

export class TripHasNoDriverException extends UnprocessableEntityException {
  constructor() {
    super(
      "This Trip has no driver, so there is nobody to send the transport order to.",
    );
  }
}

export class DriverHasNoPhoneNumberException extends UnprocessableEntityException {
  constructor(driverName: string) {
    super(`${driverName} has no phone number, so nothing can be sent.`);
  }
}

export class UnusablePhoneNumberException extends UnprocessableEntityException {
  constructor(driverName: string) {
    super(
      `The phone number recorded for ${driverName} cannot be used for WhatsApp. It must be an international number, starting with a country code.`,
    );
  }
}

export class TripHasNoTransportDocumentException extends UnprocessableEntityException {
  constructor() {
    super(
      "This Trip has no transport order to send. It was created by hand rather than from a document.",
    );
  }
}

/**
 * The Trip's status does not permit sending.
 *
 * A CANCELLED transport was called off: sending its order to a driver would say
 * it is happening after all. It is reopened first, which is a decision about the
 * day's work rather than a side effect of pressing send. DELETED is out of the
 * planning entirely.
 */
export class TripCannotSendInStatusException extends UnprocessableEntityException {
  constructor(status: TripStatus) {
    super(
      status === TripStatus.CANCELLED
        ? "This transport was cancelled. Reopen it before sending the transport order to a driver."
        : "This Trip is not part of the planning, so no transport order can be sent for it.",
    );
  }
}

/**
 * The document exists as a record but its file is gone from storage.
 *
 * 502 rather than 404: the Trip and its document are both fine, and the fault is
 * on this system's side of the request.
 */
export class TransportDocumentUnreadableException extends BadGatewayException {
  constructor() {
    super(
      "The transport order could not be read from storage, so it was not sent.",
    );
  }
}

export class WhatsAppNotConnectedException extends ServiceUnavailableException {
  constructor(detail: string) {
    super(`The transport order could not be sent: ${detail}`);
  }
}

export class WhatsAppSendFailedException extends BadGatewayException {
  constructor() {
    super(
      "WhatsApp did not accept the transport order. Nothing was delivered; try again.",
    );
  }
}
