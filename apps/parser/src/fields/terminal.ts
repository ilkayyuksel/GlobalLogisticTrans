import { POSTCODE_LINE } from "./address";
import { Fragment } from "../text/extract";
import { joinText, valuesBelow, valuesRightOf } from "../text/normalize";

/**
 * The terminal the container is collected from or returned to.
 *
 * The documents write it two ways, depending on the direction:
 *
 *   COLLECTION   `Return to Terminal:` above a four-line block
 *                  PSA Quay 869 / Europaterminal / Scheldelaan 495 / BE-2040 Antwerp
 *   DELIVERY     `Terminal:` beside a short name
 *                  Quay 869
 *
 * `parserLayouts.md` fixes the priority: Return to Terminal, then Redelivery
 * Depot, then Terminal, then Startpoint — Startpoint only when nothing else
 * names a terminal. That order is followed exactly.
 *
 * This module extracts, and the value it returns is what the document wrote —
 * `PSA Quay 869`, `Quay 869` — normalized but never renamed. Deciding what that
 * place is CALLED in the operator's own route configuration is a business
 * decision, so it belongs to the Backend's import layer, which is the only side
 * that knows the configured terminal names.
 */

/** In priority order. The first label that yields a value wins. */
const TERMINAL_LABELS = [
  "Return to Terminal:",
  "Redelivery Depot:",
  "Terminal:",
  "Startpoint:",
] as const;

export interface ExtractedTerminal {
  /** The block exactly as printed, newline-free. */
  readonly rawTerminal: string;
  /** The first line: the terminal's own name, e.g. `PSA Quay 869`. */
  readonly terminalKey: string;
  readonly matchedLabel: string;
}

export function extractTerminal(
  fragments: readonly Fragment[],
): ExtractedTerminal | null {
  for (const label of TERMINAL_LABELS) {
    const found = fragments.find((fragment) => fragment.text === label);

    if (!found) {
      continue;
    }

    const lines = terminalLinesFor(fragments, found);

    if (lines.length > 0) {
      return {
        rawTerminal: joinText(lines),
        terminalKey: lines[0].text,
        matchedLabel: label,
      };
    }
  }

  return null;
}

/**
 * The lines belonging to a terminal label.
 *
 * A terminal is written either beside its label or underneath it, so both are
 * tried. The block form is an address, and an address ends at its
 * `CC-postcode City` line — that is the stop condition, rather than a fixed
 * line count, because the depot blocks in the fixtures are four lines but
 * nothing guarantees the next one will be.
 */
function terminalLinesFor(
  fragments: readonly Fragment[],
  label: Fragment,
): Fragment[] {
  const beside = valuesRightOf(fragments, label)[0];

  if (beside && !isColumnLabel(beside.text)) {
    return withContinuation(beside, blockBelow(fragments, beside));
  }

  const below = blockBelow(fragments, label);

  return below.length === 0 ? [] : withContinuation(below[0], below.slice(1));
}

/**
 * Keeps the following lines only when they complete an address.
 *
 * A terminal is written either as a bare name or as an address block, and an
 * address block always ends at its `CC-postcode City` line. Lines that never
 * reach one are not a continuation at all — they are the next fields' values,
 * which this multi-column form happens to place in the same column. Under
 * `Terminal: Quay 869` sit the values of `Booking no:` and `Customer ref:`,
 * and reading those as part of the terminal is exactly the mistake this
 * prevents.
 *
 * So: a postcode below means an address block; no postcode means the terminal
 * was the single name beside the label.
 */
function withContinuation(first: Fragment, rest: Fragment[]): Fragment[] {
  if (POSTCODE_LINE.test(first.text)) {
    return [first];
  }

  return rest.some((line) => POSTCODE_LINE.test(line.text))
    ? [first, ...rest]
    : [first];
}

function blockBelow(
  fragments: readonly Fragment[],
  label: Fragment,
): Fragment[] {
  const lines: Fragment[] = [];

  for (const candidate of valuesBelow(fragments, label)) {
    if (isColumnLabel(candidate.text)) {
      break;
    }

    lines.push(candidate);

    if (POSTCODE_LINE.test(candidate.text)) {
      break;
    }
  }

  return lines;
}

/**
 * Another form label rather than a value.
 *
 * The form's columns interleave, so the fragment beside or below a label is
 * sometimes the NEXT label instead of a value. Anything ending in a colon is
 * treated as a label, which is exactly how this document marks them.
 */
function isColumnLabel(text: string): boolean {
  return text.endsWith(":");
}
