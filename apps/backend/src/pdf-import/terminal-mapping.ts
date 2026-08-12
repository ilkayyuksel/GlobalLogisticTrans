/**
 * Translates the terminal text printed on a transport order into the terminal
 * name this system uses.
 *
 * THE TABLE IS EMPTY, AND THAT IS DELIBERATE.
 *
 * A Trip's terminal is one half of the route identity the Pricing Engine
 * resolves a RouteCost by. Map `PSA Quay 869` to the wrong terminal and every
 * Trip imported from that document is priced against the wrong route — silently,
 * because a plausible wrong name resolves just as cleanly as a right one.
 *
 * The mapping cannot be derived from the material available. The same printed
 * text `PSA Quay 869` appears on documents whose destinations the seeded routes
 * attribute to two different terminals, and the seed file states that every
 * value in it is fabricated. Guessing would therefore not be a shortcut; it
 * would be an invention presented as a fact.
 *
 * Until the real pairs are supplied by someone who knows them, an unmapped
 * terminal refuses the import. A refused import is visible and fixable. A
 * mis-mapped one is neither.
 *
 * Filling this in is a data change, not a code change: add the pairs and the
 * imports start succeeding, with no other edit anywhere.
 */
export type TerminalMapping = Readonly<Record<string, string>>;

/** Printed terminal text → terminal name. See the note above before editing. */
export const TERMINAL_NAME_BY_DOCUMENT_TEXT: TerminalMapping = {};

/**
 * The configured name for a printed terminal, or null when it is unknown.
 *
 * Returning null rather than falling back to the raw text is the whole point:
 * the caller must decide what an unknown terminal means, and here it means the
 * import stops.
 */
export function resolveTerminalName(
  documentText: string,
  mapping: TerminalMapping = TERMINAL_NAME_BY_DOCUMENT_TEXT,
): string | null {
  // Own properties only. The text comes from a PDF sent in from outside, so a
  // plain `mapping[text]` would resolve "constructor" or "toString" to an
  // inherited function and hand it on as a terminal name.
  if (!Object.prototype.hasOwnProperty.call(mapping, documentText)) {
    return null;
  }

  return mapping[documentText];
}
