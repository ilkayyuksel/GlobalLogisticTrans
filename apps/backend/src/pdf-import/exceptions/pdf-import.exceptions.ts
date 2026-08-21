/**
 * Domain exceptions for the PDF import.
 *
 * Like the Pricing Engine's, these do NOT extend Nest's HTTP exceptions. The
 * importer has no REST surface yet and will later be driven by the IMAP service
 * as well, so an HTTP status would be a guess about one of two callers. Whatever
 * eventually exposes the importer owns that mapping; until then a stable `code`
 * is what callers match on.
 *
 * Messages name the booking number and the printed terminal, because both are
 * exactly what an operator needs to fix the problem. They carry no monetary
 * value and no personal data.
 */

export const PdfImportErrorCode = {
  UNREADABLE_PDF: "IMPORT_UNREADABLE_PDF",
  NO_TRIPS_FOUND: "IMPORT_NO_TRIPS_FOUND",
  UNKNOWN_TERMINAL: "IMPORT_UNKNOWN_TERMINAL",
  INVALID_COMBINATION: "IMPORT_INVALID_COMBINATION",
  COST_CONFIRMATION_REFUSED: "IMPORT_COST_CONFIRMATION_REFUSED",
  REVISION_REFUSED: "IMPORT_REVISION_REFUSED",
} as const;

export type PdfImportErrorCode =
  (typeof PdfImportErrorCode)[keyof typeof PdfImportErrorCode];

export abstract class PdfImportException extends Error {
  protected constructor(
    readonly code: PdfImportErrorCode,
    message: string,
  ) {
    super(message);
    // Without this the class name is lost through the transpiled prototype
    // chain, and `instanceof` checks in the future mapping layer would fail.
    this.name = new.target.name;
  }
}

/**
 * The parser could not read the document at all.
 *
 * `parse` never throws — it reports — so this is the importer turning that
 * report into a failure, carrying the parser's own reason.
 */
export class UnreadablePdfException extends PdfImportException {
  constructor(
    readonly originalFilename: string,
    readonly reason: string,
  ) {
    super(
      PdfImportErrorCode.UNREADABLE_PDF,
      `"${originalFilename}" could not be parsed as a transport order: ${reason}`,
    );
  }
}

/** A readable PDF that contained no transport order. */
export class NoTripsFoundException extends PdfImportException {
  constructor(readonly originalFilename: string) {
    super(
      PdfImportErrorCode.NO_TRIPS_FOUND,
      `"${originalFilename}" contains no Trip that could be imported.`,
    );
  }
}

/**
 * The printed terminal has no configured name.
 *
 * The import stops rather than storing the raw text. A Trip's terminal is half
 * of the route identity the Pricing Engine prices against, so an unrecognised
 * terminal is missing configuration, not a value to improvise. The raw text is
 * reported verbatim because it is precisely what has to be added to the mapping.
 */
export class UnknownTerminalException extends PdfImportException {
  constructor(
    readonly documentTerminal: string | null,
    readonly bookingNumber: string,
  ) {
    super(
      PdfImportErrorCode.UNKNOWN_TERMINAL,
      documentTerminal === null
        ? `Booking "${bookingNumber}" names no terminal, so its route cannot be identified.`
        : `Terminal "${documentTerminal}" on booking "${bookingNumber}" is not mapped to a known terminal. ` +
            `Add it to the terminal mapping before importing this document.`,
    );
  }
}

/**
 * The parser reported a Combination that is not one leg out and one leg back.
 *
 * A Combination is by definition a COLLECTION paired with a DELIVERY. Anything
 * else grouped under one key would be a group whose meaning this system does not
 * know, and grouping it anyway would misrepresent it to planning and pricing.
 */
export class InvalidCombinationException extends PdfImportException {
  constructor(
    readonly bookingNumbers: readonly string[],
    readonly reason: string,
  ) {
    super(
      PdfImportErrorCode.INVALID_COMBINATION,
      `Combination [${bookingNumbers.join(", ")}] cannot be imported: ${reason}`,
    );
  }
}

/**
 * A revised transport order could not be applied.
 *
 * Every reason is a business exception rather than a defect: the Trip it
 * revises does not exist, or it is CLOSED, or it was cancelled. None of them is
 * something the system can resolve on its own — creating the Trip would turn a
 * correction into unplanned work, and rewriting a closed one would falsify what
 * was invoiced — so the document is refused and a person decides.
 *
 * Refusing is also what leaves an emailed revision unread, so it is offered
 * again rather than quietly lost.
 */
/**
 * A cost confirmation that could not be recorded.
 *
 * A business exception rather than a parser failure: the document was read
 * perfectly well, and what it names — a booking we do not have, or a subject
 * that contradicts it — is something a person has to look at. The message stays
 * unread so the next scan offers it again.
 */
export class CostConfirmationRefusedException extends PdfImportException {
  constructor(
    readonly ccNumber: string,
    readonly reason: string,
  ) {
    super(
      PdfImportErrorCode.COST_CONFIRMATION_REFUSED,
      `Cost confirmation "${ccNumber}" was not recorded: ${reason}`,
    );
  }
}

export class RevisionRefusedException extends PdfImportException {
  constructor(
    readonly bookingNumber: string,
    readonly reason: string,
  ) {
    super(
      PdfImportErrorCode.REVISION_REFUSED,
      `The revised order for booking "${bookingNumber}" was not applied: ${reason}`,
    );
  }
}
