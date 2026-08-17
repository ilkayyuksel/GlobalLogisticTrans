import { HttpException } from "@nestjs/common";

import { DuplicateBookingNumberException } from "../trips/exceptions/trip.exceptions";
import { PdfImportException } from "./exceptions/pdf-import.exceptions";

/**
 * Turning one file's failure into something an operator can act on.
 *
 * An upload of several files reports per file, so a failure here is a value
 * rather than a thrown exception: it is one entry in the response, not the fate
 * of the request. This module is the single place where an internal failure
 * becomes public text, which is what keeps a stack trace, a Prisma message or a
 * filesystem path from reaching a client by accident.
 */

/**
 * Codes a file result can carry, on top of the importer's own `IMPORT_*` codes.
 *
 * They share that prefix because a client sees one family of outcomes: the
 * distinction between "refused before parsing" and "refused while importing" is
 * ours, not the operator's.
 */
export const UploadFailureCode = {
  EMPTY_FILE: "IMPORT_EMPTY_FILE",
  NOT_A_PDF: "IMPORT_NOT_A_PDF",
  DUPLICATE_BOOKING: "IMPORT_DUPLICATE_BOOKING",
  /** Anything not recognised. The real cause goes to the log, not the client. */
  UNEXPECTED: "IMPORT_FAILED",
} as const;

export type UploadFailureCode =
  (typeof UploadFailureCode)[keyof typeof UploadFailureCode];

export interface UploadFailure {
  readonly code: string;
  /** Written for an operator, and safe to display. */
  readonly message: string;
  /**
   * False when nothing in the system anticipated this failure.
   *
   * The caller logs those with their stack, because they are defects rather
   * than documents being wrong.
   */
  readonly expected: boolean;
}

const UNEXPECTED_MESSAGE =
  "This file could not be imported because of an unexpected problem. " +
  "The failure has been logged; try again, and report it if it repeats.";

/**
 * Describes why one file failed.
 *
 * The three recognised families all carry messages written for people — the
 * importer names the booking and the parser's reason, the Trip domain names the
 * conflicting booking number — so they are passed through unchanged. Everything
 * else is deliberately generic: an unrecognised error's message may name a
 * table, a path or a driver, none of which belong in a response.
 */
export function describeImportFailure(error: unknown): UploadFailure {
  if (error instanceof DuplicateBookingNumberException) {
    return {
      code: UploadFailureCode.DUPLICATE_BOOKING,
      message: error.message,
      expected: true,
    };
  }

  if (error instanceof PdfImportException) {
    return { code: error.code, message: error.message, expected: true };
  }

  // Other domain exceptions — an unknown PdfDocument, an invalid Trip field —
  // already extend HttpException and already phrase themselves for a client.
  if (error instanceof HttpException) {
    return {
      code: UploadFailureCode.UNEXPECTED,
      message: error.message,
      expected: true,
    };
  }

  return {
    code: UploadFailureCode.UNEXPECTED,
    message: UNEXPECTED_MESSAGE,
    expected: false,
  };
}
