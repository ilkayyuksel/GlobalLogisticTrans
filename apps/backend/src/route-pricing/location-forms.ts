import { canonicalCityAlias } from "../common/city-aliases";
import { toCanonicalTerminal } from "../common/terminal";
import { canonicalTerminalAlias } from "../common/terminal-aliases";
import type { RoadEndpoints } from "./route-identity";

/**
 * How one end of a road is compared — the forms the route matcher reads.
 *
 * ── SAFE NORMALISATION, EVERY END ───────────────────────────────────────────
 * The canonical terminal rule (`PSA` before `Quay`), accents, letter case, and
 * the punctuation that never names a place (`-`, `.`, `,`, `'`, `/`).
 *
 * ── THEN BY KIND OF END ─────────────────────────────────────────────────────
 * Which end is the terminal is the Trip's own fact (`terminalEnd`); the other
 * end is its city. Only when it is known:
 *   the TERMINAL end reads through the confirmed terminal aliases;
 *   the CITY end reads through the confirmed city aliases, the `St` = `Saint`
 *     word rule, and keeps a qualifier in brackets APART — `qualifier` — so
 *     the matcher can treat it as optional information, or as the
 *     discriminator between two candidates, but never simply lose it.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Which end of a Trip's road is the terminal. */
export type TerminalEnd = "departure" | "destination";

/** One end of a road as the matcher compares it. */
export interface EndForm {
  /** The whole value: name and qualifier, normalised. */
  readonly full: string;
  /** The name without its qualifier; the whole value at a terminal. */
  readonly base: string;
  /** What stood in brackets after a city name, normalised; null when nothing. */
  readonly qualifier: string | null;
}

export interface RoadForms {
  readonly departure: EndForm;
  readonly destination: EndForm;
}

const PUNCTUATION = /[-_.,'’/()[\]]/g;
const COMBINING_MARKS = /[̀-ͯ]/g;
const WHITESPACE_RUN = /\s+/g;
/** A trailing qualifier: `Melsele (Beveren)`. One, at the end, nothing after it. */
const TRAILING_QUALIFIER = /^(.*?)\s*\(([^()]*)\)\s*$/;
/** `St` as a word of a city name, read as `Saint`. */
const ST_WORD = /\bst\b/g;

/** The canonical terminal rule, then safe normalisation. */
export function normalizeLocation(location: string): string {
  return (toCanonicalTerminal(location) ?? "")
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(PUNCTUATION, " ")
    .replace(WHITESPACE_RUN, " ")
    .trim();
}

function plainEnd(value: string): EndForm {
  const full = normalizeLocation(value);

  return { full, base: full, qualifier: null };
}

function terminalEnd(value: string): EndForm {
  return plainEnd(canonicalTerminalAlias(value) ?? value);
}

/** A city name: its confirmed equivalents applied, its qualifier kept apart. */
function cityWords(value: string): string {
  return canonicalCityAlias(normalizeLocation(value).replace(ST_WORD, "saint"));
}

function cityEnd(value: string): EndForm {
  const qualified = TRAILING_QUALIFIER.exec(value.trim());
  const base = cityWords(qualified ? qualified[1] : value);
  const qualifier = qualified ? cityWords(qualified[2]) || null : null;

  return { full: qualifier ? `${base} ${qualifier}` : base, base, qualifier };
}

/**
 * Both ends of a road, read with the TRIP's terminal end: a configured road is
 * compared end for end with the Trip's, so it is read the same way.
 */
export function roadForms(road: RoadEndpoints, terminalSide?: TerminalEnd): RoadForms {
  const formOf = (value: string, end: TerminalEnd): EndForm =>
    terminalSide === undefined
      ? plainEnd(value)
      : end === terminalSide
        ? terminalEnd(value)
        : cityEnd(value);

  return {
    departure: formOf(road.departure, "departure"),
    destination: formOf(road.destination, "destination"),
  };
}

/** The end that is not the terminal, when the terminal is known. */
export function cityEndOf(terminalSide: TerminalEnd | undefined): TerminalEnd | null {
  if (terminalSide === undefined) {
    return null;
  }

  return terminalSide === "departure" ? "destination" : "departure";
}
