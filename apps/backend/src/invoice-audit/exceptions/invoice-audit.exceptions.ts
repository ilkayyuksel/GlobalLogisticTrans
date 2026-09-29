import { BadRequestException } from "@nestjs/common";

/**
 * Domain exceptions for the invoice check.
 *
 * They extend Nest's HTTP exceptions so `AllExceptionsFilter` renders them in
 * the standard envelope without special-casing, while call sites still raise a
 * domain concept rather than a status code.
 *
 * Every one of them is a BAD REQUEST: the document is the request, and a
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
