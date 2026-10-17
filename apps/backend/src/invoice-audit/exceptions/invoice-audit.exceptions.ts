import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
} from "@nestjs/common";

/**
 * Domain exceptions for the invoice check.
 *
 * They extend Nest's HTTP exceptions so `AllExceptionsFilter` renders them in
 * the standard envelope without special-casing, while call sites still raise a
 * domain concept rather than a status code.
 *
 * The document refusals are a BAD REQUEST: the document is the request, and a
 * workbook this system cannot read is a problem with what was sent.
 */

/** No file, or a file that is not an Excel workbook at all. */
export class InvalidInvoiceFileException extends BadRequestException {
  constructor(reason: string) {
    super(`The invoice file was refused: ${reason}.`);
  }
}

/** A file that announces itself as a workbook but cannot be read as one. */
export class UnreadableInvoiceWorkbookException extends BadRequestException {
  constructor(reason: string) {
    super(`The invoice workbook could not be read: ${reason}.`);
  }
}

/**
 * The sheet has no row offering the columns the check needs.
 *
 * ── WHY THE MISSING COLUMNS TRAVEL WITH IT ──────────────────────────────────
 * "Unexpected structure" tells an operator nothing they can act on. The headers
 * this system looked for and did not find are what turns the refusal into an
 * instruction, so they travel in `details` — the same place field-level
 * validation failures already travel in this envelope.
 */
export class InvoiceColumnsMissingException extends BadRequestException {
  constructor(missingHeaders: readonly string[]) {
    super({
      message:
        "The invoice workbook does not have the expected structure, so nothing was checked.",
      details: missingHeaders.map((header) => `missing column: ${header}`),
      error: "Invoice columns missing",
    });
  }
}

/**
 * A transport chosen for payment that this invoice no longer settles.
 *
 * The selection was made on an earlier check; the confirmation checks again,
 * and something changed in between — the Trip was reopened, its price moved, a
 * line of it is now under review — or the id was never on this invoice. The
 * whole request is refused: paying the rest would leave the operator to work
 * out which of their choices were honoured.
 */
export class PaymentSelectionNoLongerEligibleException extends ConflictException {
  constructor(refused: readonly { tripId: string; reasons: readonly string[] }[]) {
    super({
      message: "Some selected transports can no longer be settled on this invoice; nothing was paid.",
      details: refused.map((trip) => `${trip.tripId}: ${trip.reasons.join(", ")}`),
      error: "Payment selection no longer eligible",
    });
  }
}

/**
 * The corrected workbook, once written, is not exactly the received one plus
 * the planned changes — see `workbook-integrity-check.ts`.
 *
 * The fault is this system's, not the document's, so it is a server error. No
 * file is answered and nothing can be paid on it; the differences travel in
 * `details` (addresses and what changed, never an amount) and are logged.
 */
export class InvoiceWorkbookIntegrityException extends InternalServerErrorException {
  constructor(problems: readonly string[]) {
    super({
      message:
        "The corrected invoice did not match its planned changes, so no file was produced and nothing can be paid on it.",
      details: [...problems],
      error: "Invoice workbook integrity",
    });
  }
}
