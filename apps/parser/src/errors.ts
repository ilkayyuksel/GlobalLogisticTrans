import { ParseFailureReason } from "./types";

/**
 * The one exception the parser uses internally.
 *
 * It never escapes: `parse()` catches it and returns a ParseFailure. Extractors
 * throw it because a missing booking number makes the rest of the page
 * meaningless, and threading a result type through every field would obscure
 * the extraction rules without changing the outcome.
 *
 * A malformed document is an ordinary result here, not an exceptional event —
 * which is why the public API has no throwing path at all.
 */
export class ExtractionError extends Error {
  constructor(
    readonly reason: ParseFailureReason,
    message: string,
    readonly missingFields: string[] = [],
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export function missingField(field: string, detail: string): ExtractionError {
  return new ExtractionError("MISSING_REQUIRED_FIELD", detail, [field]);
}
