import { ExtractionError } from "./errors";
import { extractDocumentStatus } from "./fields/document-status";
import { detectLayout } from "./layout/detect";
import { detectedSections } from "./layout/page-trip";
import { parseCombination } from "./layout/combination";
import { parseSingle } from "./layout/single";
import {
  ExtractedDocument,
  UnreadablePdfError,
  extractDocument,
} from "./text/extract";
import { ParseFailure, ParseMetadata, ParseResult, ParsedTrip } from "./types";

export * from "./types";
export { PARSER_VERSION } from "./version";

import { PARSER_VERSION } from "./version";

/**
 * Turns a transport order PDF into structured facts.
 *
 * The whole library is this one function. It reads a PDF and returns what the
 * document says — no database, no HTTP, no pricing, no decisions about whether
 * a Trip should exist. The Backend validates and decides.
 *
 * IT NEVER THROWS. A corrupt file, an unknown layout and a missing booking
 * number are all ordinary outcomes for a parser whose input arrives by email
 * from outside the business, so each returns a ParseFailure describing what
 * went wrong and what was seen. An import must never fail because the parser
 * raised.
 *
 * Deterministic: the same bytes always produce the same result. Nothing here
 * reads a clock, a random source or the environment.
 */
export async function parse(source: Uint8Array): Promise<ParseResult> {
  let document: ExtractedDocument;

  try {
    document = await extractDocument(source);
  } catch (error: unknown) {
    return failure(
      error instanceof UnreadablePdfError ? "INVALID_PDF" : "UNREADABLE_PDF",
      error instanceof Error
        ? `The file could not be read as a PDF: ${error.message}`
        : "The file could not be read as a PDF.",
      [],
      emptyMetadata(),
      [],
    );
  }

  const metadata: ParseMetadata = {
    pageCount: document.pageCount,
    fragmentCount: document.fragments.length,
    detectedSections: detectedSections(document.fragments),
  };

  // A PDF with no text layer is readable but carries nothing to extract. It is
  // reported as such rather than passed on to OCR, which this parser does not
  // do and must not silently acquire.
  if (document.fragments.length === 0) {
    return failure(
      "UNREADABLE_PDF",
      "The PDF has no text layer, so no information can be extracted from it.",
      [],
      metadata,
      [],
    );
  }

  try {
    const layout = detectLayout(document);
    const trips: ParsedTrip[] =
      layout === "COMBINATION_TWO_PAGE"
        ? parseCombination(document.fragments, groupKeyFor(document))
        : parseSingle(document.fragments);

    return {
      ok: true,
      layout,
      // What the document says about itself, independent of any email that
      // carried it and of what the Backend decides to do about it.
      documentStatus: extractDocumentStatus(document.fragments),
      parserVersion: PARSER_VERSION,
      trips,
      metadata,
    };
  } catch (error: unknown) {
    if (error instanceof ExtractionError) {
      return failure(
        error.reason,
        error.message,
        error.missingFields,
        metadata,
        labelsIn(document),
      );
    }

    // An unexpected fault is still returned rather than thrown, because the
    // caller's contract is "always a result". The message is kept, the stack is
    // not: it would leak internals into an import log.
    return failure(
      "UNREADABLE_PDF",
      `The document could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
      [],
      metadata,
      labelsIn(document),
    );
  }
}

/**
 * Ties the two trips of a combination together.
 *
 * Derived from the document's own booking numbers, so it is stable across runs
 * — the same PDF always yields the same key — and readable in a log. It is
 * temporary parser metadata; the Backend replaces it with a real Trip Group.
 */
function groupKeyFor(document: ExtractedDocument): string {
  const bookings = document.fragments
    .map(
      (fragment) =>
        /Bookings nr\/Trip nr:\s*(\S+)\s*\//.exec(fragment.text)?.[1],
    )
    .filter((booking): booking is string => Boolean(booking));

  return `combination:${[...new Set(bookings)].sort().join("+")}`;
}

/** Labels present in the document, so a failure can be diagnosed. */
function labelsIn(document: ExtractedDocument): string[] {
  const labels = document.fragments
    .map((fragment) => fragment.text)
    .filter((text) => text.endsWith(":") && text.length <= 40);

  return [...new Set(labels)].sort();
}

function failure(
  reason: ParseFailure["reason"],
  message: string,
  missingFields: string[],
  metadata: ParseMetadata,
  detectedLabels: string[],
): ParseFailure {
  return {
    ok: false,
    reason,
    message,
    missingFields,
    detectedLabels,
    metadata,
  };
}

function emptyMetadata(): ParseMetadata {
  return { pageCount: 0, fragmentCount: 0, detectedSections: [] };
}
