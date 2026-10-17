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
    super(`Het factuurbestand is geweigerd: ${reason}.`);
  }
}

/** A file that announces itself as a workbook but cannot be read as one. */
export class UnreadableInvoiceWorkbookException extends BadRequestException {
  constructor(reason: string) {
    super(`De factuur kon niet gelezen worden: ${reason}.`);
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
        "De factuur heeft niet de verwachte opbouw; er is niets gecontroleerd.",
      details: missingHeaders.map((header) => `ontbrekende kolom: ${header}`),
      error: "Kolommen ontbreken",
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
  /** `trip`: the booking number a person recognises, or the Trip id without one. */
  constructor(refused: readonly { trip: string; reasons: readonly string[] }[]) {
    super({
      message: "Een of meer gekozen ritten kunnen niet meer met deze factuur betaald worden; er is niets op betaald gezet.",
      details: refused.map((refusal) => `${refusal.trip}: ${refusal.reasons.join(", ")}`),
      error: "Keuze niet meer te betalen",
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
        "De gecorrigeerde factuur komt niet overeen met de geplande wijzigingen; er is geen bestand gemaakt en er kan niets op betaald worden.",
      details: [...problems],
      error: "Controle gecorrigeerde factuur",
    });
  }
}
