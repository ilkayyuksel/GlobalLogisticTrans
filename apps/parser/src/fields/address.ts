import { ExtractionError, missingField } from "../errors";
import {
  COUNTRY_BY_POSTCODE_PREFIX,
  countryFromName,
  isCountryName,
  isSubdivisionCode,
  splitTrailingCountry,
} from "./country";
import { COLUMN_TOLERANCE, Fragment, ROW_TOLERANCE } from "../text/extract";
import {
  findLabel,
  joinText,
  toTitleCase,
  valuesBelow,
  valuesRightOf,
} from "../text/normalize";

/** The voyage block's own address label — the last-resort source. */
const STARTPOINT_LABEL = "Startpoint:";

/**
 * Destination city and country, from the LOADING / DELIVERY address block.
 *
 * `parserLayouts.md` says to locate the `Address:` label and read the lines
 * that follow. The real documents do not support that: the `Address:` label
 * shares its row with the first address line AND with the Remarks column, so
 * "the lines after the label" is not a well-defined set.
 *
 * The postcode line is the reliable anchor instead. It matched all four trips
 * in the fixtures, in every country, whether or not a country line followed:
 *
 *   F-62119 DOURGES        BE-9130 Kallo
 *   FR-59166 Bousbecque    BE-7784 Warneton
 *
 * The whole block is kept in `rawAddress` so the street and company survive for
 * diagnostics even though only the city and country are stored.
 */

/**
 * The postcode itself, shared by the prefixed and the bare form.
 *
 * ── WHY ONE FRAGMENT ────────────────────────────────────────────────────────
 * The two rules each knew half of what a postcode can look like, and a real
 * order needed both halves at once:
 *
 *     NL-4612PS Bergen op Zoom
 *
 * The prefixed rule understood `NL-` but demanded whitespace straight after the
 * digits, so `PS` stopped it. The bare rule understood `4612PS` but required the
 * line to START with a digit, so `NL-` stopped it. Every rule declined and a
 * document naming its destination plainly was reported unreadable.
 *
 * Written once here, both forms are now understood by both rules, and neither
 * can learn about a postcode shape the other does not.
 *
 * ── THE TWO LETTERS MUST BE CAPITALS ────────────────────────────────────────
 * That is what a Netherlands postcode is, and it is what stops the pattern from
 * eating the first word of a city: `2040 An Twerpen` keeps its `An`, while the
 * regex engine backtracks out of `62119 DO` in `F-62119 DOURGES` the moment the
 * separator that must follow is missing.
 */
const POSTCODE = String.raw`\d{4,5}(?:\s?[A-Z]{2})?`;

/**
 * `CC-NNNNN City` — the one line that identifies where a trip actually goes.
 *
 * ── THE PREFIX IS CASE-INSENSITIVE, AND HAS TO BE ───────────────────────────
 * It was `[A-Z]{1,2}` and every fixture agreed, because every fixture printed
 * `F-62119 DOURGES`, `FR-59166 Bousbecque`, `BE-9130 Kallo`. Then a real order
 * arrived printing its own address in lower case:
 *
 *     [8580]
 *     IVC bvba
 *     Nijverheidslaan 29
 *     be-8580 Avelgem          <- `be`, not `BE`
 *
 * and this rule did not match it. Neither did any of the others: the bare-
 * postcode rule needs the line to START with digits, and the bracketed
 * last-resort refuses a final line containing a digit — which `be-8580
 * Avelgem` does. So all four rules declined and a document naming its
 * destination unmistakably was reported as having no readable city.
 *
 * Letter case is a typographical choice by whoever filled in the form. It says
 * nothing about what the line MEANS, so it must not decide whether the line is
 * read. The country lookup already upper-cases the prefix before consulting the
 * table, so `be` and `BE` resolve identically.
 * ────────────────────────────────────────────────────────────────────────────
 */
export const POSTCODE_LINE = new RegExp(
  String.raw`^([A-Za-z]{1,2})\s*-\s*(${POSTCODE})\s+(.+)$`,
);

/**
 * The postcode as an address line prints it — possibly TWICE.
 *
 * ── THE LAYOUT THIS EXISTS FOR ──────────────────────────────────────────────
 * A real order prints its loading address like this:
 *
 *     [9160]
 *     Willems Biscuits
 *     Zoomstraat 2 AA
 *     9160 9160 Lokeren        <- the postcode, twice
 *     Belgium
 *
 * The form has printed the customer's postcode field and the address line's own
 * postcode next to each other. Every rule that reads a postcode expects exactly
 * one, and each of them requires the city to begin with a LETTER immediately
 * afterwards — which is what keeps a house number out of the city field. With a
 * second number in the way none of them matched, and a document naming its
 * destination plainly was reported as having no readable city.
 *
 * ── WHY A BACKREFERENCE AND NOT A SECOND NUMBER ─────────────────────────────
 * `\k<name>` matches the FIRST postcode's exact text, so only a genuine repeat
 * is absorbed. `1234 5678 Lokeren` still matches nothing: the two differ, so
 * the optional group declines, and the city group then meets `5678` and fails —
 * which is the existing behaviour, and the right one. Two different numbers are
 * not a postcode printed twice, and this must never become "skip any digits in
 * front of a word".
 *
 * It takes the pattern and a group name rather than being one fixed constant,
 * because the two lines that need it accept different digit runs — see
 * `POSTCODE_THEN_CITY`, which is deliberately wider.
 */
function printedOnceOrTwice(postcode: string, groupName: string): string {
  return String.raw`(?<${groupName}>${postcode})(?:\s+\k<${groupName}>)?`;
}

/**
 * `NNNN City` — the same line without its country prefix.
 *
 * Real orders print `2040 Antwerpen`, `3980 Tessenderlo` and `9940 Evergem,`.
 * The trailing comma is part of a comma-separated address and belongs to the
 * punctuation, not to the name.
 *
 * ── THE DUTCH FORM ──────────────────────────────────────────────────────────
 * A Netherlands postcode carries two letters after its digits, printed with or
 * without a space: `4704RG Roosendaal`, `4704 RG Roosendaal`. Without them the
 * line matched no rule at all and the whole address was reported unreadable.
 *
 * The letters must be UPPERCASE, which is what a postcode is and what keeps the
 * pattern from eating the start of a city name: `2040 An Twerpen` would
 * otherwise lose its first word, while `BE-8730 Beernem` and `9940 Evergem` are
 * unaffected because `Be` and `Ev` are not two capitals.
 *
 * The number says nothing about WHICH country: 59554 is Raillencourt-Sainte-Olle
 * in France and Lippstadt in Germany. So this line yields a city, and the
 * country has to come from somewhere the document actually states it.
 */
const BARE_POSTCODE_LINE = new RegExp(
  String.raw`^${printedOnceOrTwice(POSTCODE, "postcode")}[\s,]+([A-Za-z].*)$`,
);

/**
 * `[NNNNN]` — the customer reference the order prints above every address.
 *
 * It is the postcode again, in brackets. On most documents it is redundant; on
 * one real order it is the ONLY postcode present, which is what makes the last
 * address line identifiable as the city.
 */
const BRACKETED_POSTCODE = /^\[(\d{4,5})\]$/;

/** The postcode the block opens with in brackets, or null when it opens otherwise. */
function bracketedPostcodeOf(block: readonly Fragment[]): string | null {
  return BRACKETED_POSTCODE.exec(block[0]?.text.trim() ?? "")?.[1] ?? null;
}

/** The bracket, a company, a street and the city: anything less is truncated. */
const MINIMUM_ADDRESS_LINES = 4;

/**
 * `Evergem,` is the same city as `Evergem` — and `Kallo, Belgium` is `Kallo`.
 *
 * The trailing country is removed here, in the one function every rule already
 * passes its city through, so no rule can produce a city with a country stuck
 * to it. The removal is structural: `splitTrailingCountry` only fires when the
 * trailing words are exactly a known country name, so a real city is never
 * truncated because its letters happen to resemble one.
 */
function toCityName(value: string): string {
  const trimmed = value.trim().replace(/[,;]+$/, "").trim();

  return splitTrailingCountry(trimmed)?.rest ?? trimmed;
}

/** The country a city line carried with it, when it carried one. */
function countryOnCityLine(value: string): string | null {
  return splitTrailingCountry(value.trim())?.country ?? null;
}

export interface ExtractedAddress {
  /**
   * Null when the address block states NO place — see `statesNoPlace`. It is
   * never null because a city could not be read: that still refuses.
   */
  readonly destinationCity: string | null;
  /** Null when the document states no country. */
  readonly destinationCountry: string | null;
  readonly rawAddress: string;
  readonly section: string;
}

/**
 * The address block belongs to a section: `LOADING 1:` on a collection,
 * `DELIVERY 1:` on a delivery. The section header fixes which block to read
 * when a page contains more than one.
 */
export function extractAddress(
  fragments: readonly Fragment[],
  sectionHeader: Fragment,
): ExtractedAddress {
  const block = addressBlockOf(fragments, sectionHeader);

  if (block.length === 0) {
    throw new ExtractionError(
      "MALFORMED_ADDRESS",
      `The '${sectionHeader.text}' section contains no address lines.`,
      ["destinationCity"],
    );
  }

  const place = readPlace(block, fragments);

  if (!place) {
    /*
     * ── A BLOCK MAY STATE NO PLACE AT ALL ───────────────────────────────────
     * Which is a different fact from one this parser could not read, and the
     * two must not share an answer. A real order prints:
     *
     *     [8700]
     *     Novaya Handling
     *     Ten Hovestraat 32
     *     8700
     *
     * — the postcode, a company, a street, and the postcode again. There is no
     * city in it to find. Refusing that order treated an ABSENT field as a
     * broken one and blocked a transport nobody could unblock, because the
     * document is what it is.
     *
     * So an address that names no place yields a NULL city, which is what this
     * project does with every other absent value, and an operator fills it in
     * from the Ritten list. A block whose city is present but unreadable still
     * fails loudly — that signal is what found the last three parser bugs, and
     * `statesNoPlace` is deliberately narrow to preserve it.
     */
    if (statesNoPlace(block)) {
      return {
        destinationCity: null,
        destinationCountry: null,
        rawAddress: joinText(block),
        section: sectionHeader.text.replace(/:$/, ""),
      };
    }

    throw new ExtractionError(
      "MALFORMED_ADDRESS",
      `No readable city line was found under '${sectionHeader.text}'. Read instead: ${JSON.stringify(joinText(block))}.`,
      ["destinationCity"],
    );
  }

  const city = toCityName(place.city);

  /*
   * ── THE INVARIANT, ENFORCED WHERE EVERY RULE MEETS ────────────────────────
   * A destination city is never a country. Each rule above already declines the
   * lines it can recognise as a country, but those are five separate defences
   * and this is the one place all of them come back together — so the guarantee
   * holds even if a future rule forgets, and it holds for a layout none of them
   * anticipated.
   *
   * It REFUSES rather than falling through to a weaker rule. A block whose only
   * candidate is a country states no city at all, and reporting the address as
   * unreadable is the honest answer: a Trip routed to "Belgium" would match no
   * configured route and would tell an operator nothing.
   */
  if (isCountryName(city)) {
    throw new ExtractionError(
      "MALFORMED_ADDRESS",
      `The '${sectionHeader.text}' section names a country where its city should be. Read instead: ${JSON.stringify(joinText(block))}.`,
      ["destinationCity"],
    );
  }

  return {
    destinationCity: toTitleCase(city),
    destinationCountry: place.country ?? countryOnCityLine(place.city),
    rawAddress: joinText(block.slice(0, place.lastLineIndex + 1)),
    section: sectionHeader.text.replace(/:$/, ""),
  };
}

/**
 * The rules that read a place out of an address block, strongest evidence
 * first.
 *
 * ── THE ORDER IS THE STRUCTURE, NOT A PREFERENCE ────────────────────────────
 * Each rule answers a question the one before it could not, and every one of
 * them is narrower than "take the last line". They are listed here once and
 * shared by both callers, so a numbered section and a `Startpoint:` block can
 * never drift apart in how they are read.
 *
 *   1. `CC-NNNNN City`        the normal printed form
 *   2. a country on its OWN line, naming the city directly above it
 *   3. a postcode and a country SHARING a line, same idea, different layout
 *   4. `NNNNN City`, when no country is stated beside it
 *   5. the bracketed reference, when the block states no postcode at all
 *
 * Rules 2 and 3 are siblings: both say "the country is stated, so the city is
 * the line beside it". They stay separate functions because the EVIDENCE
 * differs — a line that IS a country, and a line that ENDS in one after a
 * postcode.
 */
function readPlace(
  block: readonly Fragment[],
  fragments: readonly Fragment[],
): ReadPlace | null {
  return (
    readPrefixedPostcode(block) ??
    readCountryLine(block) ??
    readPostcodeCountryLine(block) ??
    readBarePostcode(block, fragments) ??
    readBracketedPostcode(block)
  );
}

/**
 * The city and country an address block states, and where it stops.
 *
 * `lastLineIndex` is the final line that is part of the address itself. The
 * value column keeps going afterwards — `2pages.pdf` prints `Loading Ref:` and
 * a packing instruction directly underneath — and those are remarks, not part
 * of where the trip goes.
 */
interface ReadPlace {
  readonly city: string;
  /**
   * Null when the document names no country.
   *
   * Not every transport order does, and none of the alternatives is honest: a
   * postcode belongs to no country on its own, and borrowing the terminal's
   * country would put a French address in Belgium. An absent country is
   * recorded as absent.
   */
  readonly country: string | null;
  readonly lastLineIndex: number;
}

/**
 * The normal form: `F-62119 DOURGES`, optionally followed by a country line.
 *
 * This is what almost every order prints, and it is tried first so the two
 * variations below can never change how an ordinary document is read.
 */
function readPrefixedPostcode(block: readonly Fragment[]): ReadPlace | null {
  const index = block.findIndex((fragment) =>
    POSTCODE_LINE.test(fragment.text),
  );

  if (index === -1) {
    return null;
  }

  const match = POSTCODE_LINE.exec(block[index].text);

  if (!match) {
    return null;
  }

  const [, prefix, , city] = match;

  /*
   * `BE-8730 Belgium` is a postcode and a COUNTRY, not a postcode and a city.
   * Reading it here would store "Belgium" as the destination, so the line is
   * declined and `readPostcodeCountryLine` takes it — which knows to look for
   * the city on the line beside it.
   */
  if (isCountryName(city)) {
    return null;
  }

  const next = block[index + 1] ?? null;
  const statedCountry = next ? countryFromName(next.text) : null;

  return {
    city,
    country: resolveCountry(prefix, next),
    lastLineIndex: index + (statedCountry ? 1 : 0),
  };
}

/**
 * VARIATION 1 — the country is spelled out instead of prefixing the postcode.
 *
 * A real order ends its address:
 *
 *   Kallo
 *   Belgium
 *
 * with the postcode printed only in the bracketed reference at the top. The
 * country word is authoritative when the document prints one, so it names the
 * country and the line directly above it names the city.
 *
 * Only a KNOWN country name is accepted, and only as the last line of the
 * address. The same column carries remarks in other documents, so accepting
 * "whatever follows the city" would store a reference number as a country.
 */
function readCountryLine(block: readonly Fragment[]): ReadPlace | null {
  for (let index = block.length - 1; index > 0; index -= 1) {
    const country = countryFromName(block[index].text);

    if (!country) {
      continue;
    }

    const cityLine = block[index - 1].text.trim();

    // The line above must not be another country, and must not be the prefixed
    // form — that is the normal layout, handled above, and reaching it here
    // would mean something is wrong.
    if (
      cityLine.length === 0 ||
      countryFromName(cityLine) !== null ||
      POSTCODE_LINE.test(cityLine)
    ) {
      return null;
    }

    /*
     * It MAY carry its own postcode, and real orders do:
     *
     *   9940 Evergem,        4880 Aubel        Moerdijk, 4782 PP ,
     *   Belgium              Belgium           Netherlands
     *
     * The postcode is dropped rather than kept — a city is a name, and
     * "9940 Evergem" as a destination would match no configured route and read
     * as nonsense in an export. The country still comes from the word below,
     * never from the number. Either order of the two is read; see
     * `cityWithoutPostcode`.
     */
    const city = toCityName(
      cityWithoutPostcode(cityLine, {
        ownPostcode: bracketedPostcodeOf(block),
        country,
      }),
    );

    /*
     * A city carries no digits; a street does — `Ketenislaan 1`, `Rue de Kan
     * 7`. Without this, a block whose last two lines are a street and a country
     * would store the STREET as the destination, which matches no route and
     * misleads an operator. `cityAbove` refuses the same shape for the sibling
     * layout, and the two must agree.
     *
     * The postcode form above is already reduced to its name by then, so
     * `9940 Evergem,` still reads as `Evergem` and is unaffected.
     */
    if (city.length === 0 || /\d/.test(city)) {
      return null;
    }

    return { city, country, lastLineIndex: index };
  }

  return null;
}

/**
 * VARIATION 1b — the postcode and the country share ONE line.
 *
 * ── THE LAYOUT THAT BROKE THE OLD READING ───────────────────────────────────
 * A real order prints its address like this:
 *
 *   [62110]
 *   AMD
 *   416 Boulevard Ferdinand de Lesseps
 *   Heinin-Beaumont
 *   62110 France
 *
 * There is no `CC-NNNNN City` line, and the last line is not a country on its
 * own — so the two rules above both declined, and the bare-postcode rule read
 * `62110 France` as "postcode 62110, city France". The destination became the
 * COUNTRY, and the country field was left empty. That is the bug this rule
 * exists to remove.
 *
 * ── WHAT THE LINE ACTUALLY MEANS ────────────────────────────────────────────
 * A number followed by a country name is a postcode and a country. It contains
 * no city at all, so the city has to come from the line beside it — the same
 * structural move `readCountryLine` makes for a country printed on its own
 * line. The two are siblings; only the layout differs.
 *
 * Both postcode forms are accepted, because both occur:
 *
 *   62110 France        bare
 *   BE-8730 Belgium     prefixed
 *
 * ── AND WHEN THERE IS NO CITY TO FIND ───────────────────────────────────────
 * The search upward stops at anything that is not a city name, and REFUSES
 * rather than guessing. A street keeps its number — `416 Boulevard Ferdinand
 * de Lesseps` — so a block that states no city between the street and the
 * postcode line yields nothing here and falls through to the rules below. A
 * street stored as a destination would match no route and mislead an operator,
 * which is worse than an address reported as unreadable.
 *
 * A line holding ONLY a postcode is stepped over on the way up: `62110` above
 * `62110 France` is the same number twice, not a place.
 */
function readPostcodeCountryLine(block: readonly Fragment[]): ReadPlace | null {
  for (let index = block.length - 1; index > 0; index -= 1) {
    const country = countryOnPostcodeLine(block[index].text);

    if (!country) {
      continue;
    }

    const city = cityAbove(block, index, country);

    return city === null ? null : { city, country, lastLineIndex: index };
  }

  return null;
}

/**
 * The country a postcode line names, or null when it names a city instead.
 *
 * `62110 France` and `BE-8730 Belgium` yield a country; `62110 Heinin-Beaumont`
 * and `BE-8730 Beernem` yield null, because their trailing text is a place
 * rather than one of the known country names. Only exact, known names count —
 * the same rule `countryFromName` applies everywhere else, so a remark sharing
 * the column can never be read as a country.
 */
function countryOnPostcodeLine(line: string): string | null {
  const match =
    POSTCODE_LINE.exec(line.trim()) ?? BARE_POSTCODE_LINE.exec(line.trim());

  if (!match) {
    return null;
  }

  // The trailing text: group 3 on the prefixed form, group 2 on the bare one.
  return countryFromName(match[match.length - 1]);
}

/**
 * The city stated above a postcode-and-country line, or null when none is.
 *
 * Walks upward from the line, stepping over a line that holds only a postcode,
 * and stops at the first line that could be a place name. Everything else —
 * a street, a company, the bracketed reference, another country — ends the
 * search with null, because a wrong city is worse than a missing one.
 */
function cityAbove(
  block: readonly Fragment[],
  postcodeLineIndex: number,
  country: string,
): string | null {
  const context: CityLineContext = {
    ownPostcode: bracketedPostcodeOf(block),
    country,
  };

  for (let index = postcodeLineIndex - 1; index >= 0; index -= 1) {
    // The same layouts `readCountryLine` accepts: the city may carry its
    // postcode on either side of the name. The two readers must agree.
    const line = toCityName(cityWithoutPostcode(block[index].text, context));

    // The same postcode printed on a line of its own says nothing new.
    if (POSTCODE_ONLY_LINE.test(line)) {
      continue;
    }

    if (line.length === 0) {
      continue;
    }

    /*
     * A city carries no digits. A street does — "416 Boulevard Ferdinand de
     * Lesseps", "Rue de Kan 7" — and so does the bracketed reference. This is
     * the same test `readBracketedPostcode` applies for the same reason.
     */
    if (/\d/.test(line) || isCountryName(line)) {
      return null;
    }

    return line;
  }

  return null;
}

/** `62110` — a postcode occupying a line by itself. */
const POSTCODE_ONLY_LINE = /^\d{4,5}$/;

/**
 * A postcode token followed by the city: `BE-8730 Beernem`, `9940 Evergem`,
 * and — the reason the digit run is deliberately wide — `FR-6212603 Wimille`.
 *
 * ── WHY IT ACCEPTS MORE DIGITS THAN A POSTCODE HAS ──────────────────────────
 * A real order prints `FR-6212603 Wimille`: the postcode with a three-digit
 * suffix run onto it. `POSTCODE_LINE` requires four or five digits followed by
 * a space and therefore declines it, and every other rule declined it too — so
 * the whole string was stored as the destination, which is where the recorded
 * city `Fr-6212603 Wimille` came from.
 *
 * A postcode must never become part of the city, whatever its length, so the
 * leading number is dropped and the NAME after it is the city. The name must
 * begin with a letter, which is what stops a house number from being read as
 * one: `416 Boulevard Ferdinand` has only three digits and does not match at
 * all.
 */
const POSTCODE_THEN_CITY = new RegExp(
  String.raw`^(?:[A-Za-z]{1,2}\s*-\s*)?` +
    printedOnceOrTwice(String.raw`\d{4,8}(?:\s?[A-Z]{2})?`, "postcode") +
    String.raw`[\s,]+(?<city>[A-Za-z].*)$`,
);

/**
 * The mirror layout: the city first, its postcode after it.
 *
 *     Moerdijk, 4782 PP ,
 *
 * Real orders print both orders of the same two facts, and only the
 * postcode-first form was read. The city-first form fell through every rule —
 * the digit guard refused it as a possible street — down to the bracketed
 * last resort, which then took whatever digit-free line came after it.
 *
 * ── DELIBERATELY NARROW ─────────────────────────────────────────────────────
 * The postcode must be the WHOLE of what follows the comma, so a street keeps
 * being refused: `Graanweg 17,` has a two-digit number, not a postcode, and
 * `Kallo, Belgium` has no digits at all. The trailing comma the form prints is
 * optional, and the captured name is trimmed by `toCityName` as everywhere.
 */
const CITY_THEN_POSTCODE =
  /^(.+?)\s*,\s*(?:[A-Za-z]{1,2}\s*-\s*)?\d{4,5}(?:\s?[A-Z]{2})?\s*,?\s*$/;

/**
 * The city first and the block's OWN postcode last, with no comma between —
 * and, optionally, a subdivision code in the middle:
 *
 *     [2920]
 *     VERMEIREN NV
 *     VERMEIRENPLEIN 1-15
 *     KALMTHOUT VAN 2920       <- city, province code, postcode
 *     BELGIUM
 *
 * `VAN` is the ISO 3166-2 code of the province of Antwerp. `CITY_THEN_POSTCODE`
 * needs its comma, so this line kept its digits, the digit guard refused it as
 * a possible street, and the order was reported as having no readable city.
 *
 * ── THE NUMBER MUST BE THE BLOCK'S OWN POSTCODE ─────────────────────────────
 * Without a comma, "words then four digits" is also a street with a long house
 * number, and a real order prints one: `Kruipin Harbour 1145`. So the trailing
 * number is accepted only when it IS the postcode the block opens with in
 * brackets — evidence the document gives, not an assumption about digits.
 *
 * ── A WORD IS A CODE ONLY IF THE STATED COUNTRY HAS IT ──────────────────────
 * A short capitalised word before the postcode may equally be the end of a
 * name — `KAPELLE OP DEN BOS`, `BERG EN DAL`. It is set aside only when it is a
 * subdivision code of the country the block states (`isSubdivisionCode`). When
 * it is shaped like a code but the country has no such code, the line could be
 * read either way, so it is refused rather than cut at a guessed word. A single
 * word is always the name: `SPA 4900` is Spa.
 */
const CITY_THEN_OWN_POSTCODE =
  /^(?<name>[A-Za-z].*?)\s+(?<postcode>\d{4,5})\s*,?\s*$/;

/** A word shaped like a subdivision code: `VAN`, `NB`. */
const CODE_SHAPED_WORD = /^[A-Z]{2,3}$/;

/** What a city line is read against: the block it sits in. */
interface CityLineContext {
  /** The postcode the block opens with in brackets: `[2920]`. */
  readonly ownPostcode: string | null;
  /** The country the block states, which decides what a subdivision code is. */
  readonly country: string | null;
}

/** The name on a `CITY [CODE] POSTCODE` line, or null when it is not one. */
function cityBeforeOwnPostcode(
  line: string,
  context: CityLineContext,
): string | null {
  const match = CITY_THEN_OWN_POSTCODE.exec(line.trim());

  if (
    !match?.groups ||
    context.ownPostcode === null ||
    match.groups.postcode !== context.ownPostcode
  ) {
    return null;
  }

  const name = match.groups.name;
  const words = name.split(/\s+/);
  const lastWord = words[words.length - 1];

  if (words.length > 1 && isSubdivisionCode(context.country, lastWord)) {
    return words.slice(0, -1).join(" ");
  }

  if (words.length > 1 && CODE_SHAPED_WORD.test(lastWord)) {
    return null;
  }

  return name;
}

/**
 * The city a line names, with its postcode removed whichever side it sits on.
 *
 * One helper for every layout, so the two readers that need it cannot disagree
 * about what counts as a city line.
 */
function cityWithoutPostcode(line: string, context: CityLineContext): string {
  const postcodeFirst = POSTCODE_THEN_CITY.exec(line);

  if (postcodeFirst) {
    // By NAME: the postcode is a capturing group of its own now, so the city is
    // no longer the first one.
    return postcodeFirst.groups?.city ?? line;
  }

  const postcodeLast = CITY_THEN_POSTCODE.exec(line);

  if (postcodeLast) {
    return postcodeLast[1];
  }

  // Unchanged when it is not that layout either, so the digit guard the caller
  // applies still refuses a street.
  return cityBeforeOwnPostcode(line, context) ?? line;
}

/**
 * VARIATION 2 — a bare postcode: `2040 Antwerpen`, with no `BE-` prefix.
 *
 * A postcode alone belongs to no country: 2040 is a real postcode in several.
 * So the country is not derived from the number — it is taken from an explicit
 * `CC-<the same postcode>` printed elsewhere on the page, which in the real
 * document is the depot line `BE-2040 Antwerp`. That is evidence the document
 * itself provides, not an assumption about numbering.
 *
 * When the document states no country anywhere, the city is still read and the
 * country is reported as ABSENT. That is the honest answer: `3980 Tessenderlo`
 * names a place beyond doubt, and inventing "Belgium" from the digits would be
 * a guess the document does not support.
 */
function readBarePostcode(
  block: readonly Fragment[],
  fragments: readonly Fragment[],
): ReadPlace | null {
  for (let index = block.length - 1; index >= 0; index -= 1) {
    const match = BARE_POSTCODE_LINE.exec(block[index].text.trim());

    if (!match) {
      continue;
    }

    const [, postcode, city] = match;

    /*
     * Defence in depth. `readPostcodeCountryLine` above already claims a line
     * like `62110 France`, so this should be unreachable — but the invariant
     * "a country is never a city" must not depend on the order of the rules
     * that happen to run before this one.
     */
    if (isCountryName(city)) {
      continue;
    }

    return {
      city: toCityName(city),
      /*
       * `9940 Evergem, Belgium` states its country on the city's own line. The
       * postcode search stays the primary evidence; this is what the line
       * itself said, used only when the document states nothing better.
       */
      country:
        countryForBarePostcode(postcode, fragments) ?? countryOnCityLine(city),
      lastLineIndex: index,
    };
  }

  return null;
}

/**
 * VARIATION 3 — the postcode appears ONLY in the bracketed reference.
 *
 * One real order prints:
 *
 *   [59554]
 *   LENGLET
 *   ZI ACTIPOLE DE L'A2
 *   AVENUE DES DEUX VALLÉES
 *   RAILLENCOURT STE OLLE
 *
 * There is no postcode beside the city and no country anywhere, so every rule
 * above has nothing to anchor on. The bracket is what remains: the order prints
 * the customer's postcode there, above every address, which is what makes this
 * a structural reading rather than "take the last line and hope".
 *
 * Deliberately narrow, because the last line of an address block is not always
 * a city:
 *
 *   * the block must OPEN with the bracketed postcode, as these orders do;
 *   * a candidate line must carry no digit. A street keeps its number
 *     ("Transportstraat 6", "Rue de Kan 7"), a city does not, and refusing
 *     rather than guessing is what keeps a street out of the city field;
 *   * the block must hold a full address — the bracket, a company, a street and
 *     the city. Fewer lines than that is a truncated block, where the last line
 *     is as likely to be the street as the city, and a street read as a city
 *     would match no route and mislead an operator. Such a block is refused;
 *   * it runs last, so no document that any other rule can read ever reaches it.
 *
 * ── THE CITY IS NOT ALWAYS THE LAST LINE ────────────────────────────────────
 * A real order prints a gate after it:
 *
 *   [2070]
 *   BE01: Exxonmobil
 *   CANADASTRAAT 20
 *   ZWIJNDRECHT
 *   Gate 3
 *
 * Taking the last line found `Gate 3`, which carries a digit, so the rule
 * declined and a document naming its destination plainly was reported
 * unreadable. The search therefore walks UPWARD, stepping over lines that carry
 * a digit — a gate, a street, the bracket itself.
 *
 * What stops it walking into the company name is the POSITION it must reach: a
 * city may not sit where the company does. With the bracket, a company and a
 * street ahead of it, the earliest a city can appear is the fourth line, which
 * is the same completeness rule the block length already expresses. So
 * `[1234] / Acme BV / Somestreet 5` still yields nothing rather than "Acme BV".
 *
 * The country is absent, and is reported as absent: 59554 is
 * Raillencourt-Sainte-Olle in France and Lippstadt in Germany, so the number
 * decides nothing.
 */
function readBracketedPostcode(block: readonly Fragment[]): ReadPlace | null {
  if (
    block.length < MINIMUM_ADDRESS_LINES ||
    !BRACKETED_POSTCODE.test(block[0].text.trim())
  ) {
    return null;
  }

  /*
   * The earliest line a city may occupy: everything before it is the bracket,
   * the company and the street that `MINIMUM_ADDRESS_LINES` requires.
   */
  const earliestCityIndex = MINIMUM_ADDRESS_LINES - 1;

  for (let index = block.length - 1; index >= earliestCityIndex; index -= 1) {
    const line = block[index].text;
    const candidate = toCityName(line);

    // A gate, a street, a reference: not a city, and not the end of the search.
    if (candidate.length === 0 || /\d/.test(candidate)) {
      continue;
    }

    /*
     * A country is not a city, here as everywhere else. This rule is the last
     * resort, so without this a block ending in `France` would offer the
     * country as the destination — which is exactly what the invariant at the
     * top of this file then has to refuse.
     */
    if (isCountryName(candidate)) {
      return null;
    }

    /*
     * `Kallo, Belgium` on one line is a city AND a country. The country is kept
     * rather than discarded — the document stated it plainly, and this rule is
     * the only one that would otherwise report the country as absent.
     */
    return {
      city: candidate,
      country: countryOnCityLine(line),
      lastLineIndex: index,
    };
  }

  return null;
}

/**
 * The country of a bare postcode, from an explicit prefix printed elsewhere.
 *
 * Every candidate line must agree. If one part of the document printed
 * `BE-2040` and another `NL-2040`, the document would be contradicting itself
 * and the address is left unread rather than resolved by picking one.
 */
function countryForBarePostcode(
  postcode: string,
  fragments: readonly Fragment[],
): string | null {
  const countries = new Set<string>();

  for (const fragment of fragments) {
    const match = POSTCODE_LINE.exec(fragment.text.trim());

    if (!match || match[2] !== postcode) {
      continue;
    }

    const country = COUNTRY_BY_POSTCODE_PREFIX[match[1].toUpperCase()];

    if (country) {
      countries.add(country);
    }
  }

  return countries.size === 1 ? [...countries][0] : null;
}

/**
 * VARIATION 3 — the address stated under `Startpoint:`.
 *
 * One real order has no numbered section on the page that carries its booking;
 * the pickup address is printed in the voyage block instead:
 *
 *   Startpoint:  Baxter Distribution Center Europe
 *                Chemin de Papignies 17B
 *                BE-7860 Lessines
 *
 * This is a LAST RESORT and the caller enforces that: it is used only when the
 * document states no `LOADING n:` or `DELIVERY n:` section anywhere, because
 * that section is the authoritative statement of where a trip goes and
 * `Startpoint:` on an ordinary order names the TERMINAL, not the customer.
 * Reading it eagerly would silently replace real destinations with `Antwerp`.
 *
 * The lines are read with exactly the same rules as a numbered section, so the
 * three address forms above apply here too and nothing is loosened.
 */
export function extractStartpointAddress(
  fragments: readonly Fragment[],
): ExtractedAddress | null {
  const label = findLabel(fragments, STARTPOINT_LABEL);

  if (!label) {
    return null;
  }

  const firstLine = valuesRightOf(fragments, label)[0];

  if (!firstLine) {
    return null;
  }

  const block = [firstLine, ...valuesBelow(fragments, firstLine)];
  const place = readPlace(block, fragments);

  if (!place) {
    return null;
  }

  return {
    destinationCity: toTitleCase(place.city.trim()),
    destinationCountry: place.country,
    rawAddress: joinText(block.slice(0, place.lastLineIndex + 1)),
    section: STARTPOINT_LABEL.replace(/:$/, ""),
  };
}

/**
 * VARIATION 4 — the document states no customer address at all.
 *
 * ── THE LAYOUT ──────────────────────────────────────────────────────────────
 * One real order carries no `LOADING n:` or `DELIVERY n:` section, an `Address:`
 * label with an empty value column, and a `Startpoint:` label with nothing
 * beside it. Its remark is `container weer oppakken` — pick the container up
 * again — and the only place it names anywhere is the terminal, printed twice:
 * once under `Return to Terminal:` and once under `Redelivery Depot:`.
 *
 *   Return to Terminal:            Startpoint:        <- empty
 *     PSA Quay 869                 Collection Remarks:
 *     Europaterminal               Opening times:
 *     Scheldelaan 495
 *     BE-2040 Antwerp
 *
 * A move that begins and ends at the terminal HAS no customer address, so
 * refusing the document was reading an absent field as a broken one.
 *
 * ── WHY THE TERMINAL BLOCK, AND NOT "THE LINES ABOVE THE LABEL" ─────────────
 * By eye the address sits directly above `Startpoint:`. By coordinate it does
 * not: the block is at x=331.6 under `Return to Terminal:`, while `Startpoint:`
 * is at x=30.8 in another column entirely. Taking "whatever is printed above
 * the label" would cross a column boundary and, on a different form, consume
 * text belonging to neither.
 *
 * So the block is named by ITS OWN label. `extractTerminal` already finds it,
 * already stops it at the `CC-postcode City` line, and already refuses the
 * neighbouring fields that share the column — this reads a place out of exactly
 * those lines with exactly the rules a numbered section uses. Nothing is
 * loosened, and no new way of finding an address is introduced.
 *
 * ── IT CANNOT REPLACE A REAL DESTINATION ────────────────────────────────────
 * The caller reaches it only after a numbered section and a `Startpoint:` value
 * have both been looked for and neither exists. In that state the document
 * states no other location, so there is nothing for this to override — which is
 * the danger the `Startpoint:` doctrine above warns about.
 */
export function extractAddressFromLines(
  lines: readonly Fragment[],
  fragments: readonly Fragment[],
  section: string,
): ExtractedAddress | null {
  if (lines.length === 0) {
    return null;
  }

  const place = readPlace(lines, fragments);

  if (!place) {
    return null;
  }

  const city = toCityName(place.city);

  // The same invariant every other rule answers to: a country is never a city.
  if (isCountryName(city)) {
    return null;
  }

  return {
    destinationCity: toTitleCase(city),
    destinationCountry: place.country ?? countryOnCityLine(place.city),
    rawAddress: joinText(lines.slice(0, place.lastLineIndex + 1)),
    section,
  };
}

/**
 * The address lines under a section header, in the address value column.
 *
 * The column is taken from the `Address:` label's own value rather than
 * assumed, so a form whose columns shift still reads correctly. Reading stops
 * at `Date/time:`, which closes the block in every fixture.
 *
 * ── A PRINTED LINE IS NOT ALWAYS ONE FRAGMENT ───────────────────────────────
 * A PDF has no lines, only positioned runs of text, and a wide gap inside a
 * line is emitted as two runs. One real order prints its last address line as
 *
 *     62223            SAINT LAURENT BLANGY
 *     ^ x=97.5         ^ x=125.4
 *
 * — one line to a reader, two fragments to the text layer. Taking only the
 * fragment that starts at the column left the block ending in a bare postcode
 * with the city discarded, and every rule below then had nothing to read.
 *
 * So a line here is the whole ROW inside the address column, its fragments
 * joined left to right. That is the form's own geometry rather than a guess
 * about which fragment is a city, and it changes nothing for a document whose
 * rows hold a single fragment — which is all of the others.
 * ────────────────────────────────────────────────────────────────────────────
 */
function addressBlockOf(
  fragments: readonly Fragment[],
  sectionHeader: Fragment,
): Fragment[] {
  const addressLabel = fragments.find(
    (fragment) =>
      fragment.page === sectionHeader.page &&
      fragment.text === "Address:" &&
      fragment.y < sectionHeader.y,
  );

  if (!addressLabel) {
    return [];
  }

  const valueColumn = fragments
    .filter(
      (fragment) =>
        fragment.page === addressLabel.page &&
        Math.abs(fragment.y - addressLabel.y) <= ROW_TOLERANCE &&
        fragment.x > addressLabel.x,
    )
    .sort((left, right) => left.x - right.x)[0];

  if (!valueColumn) {
    return [];
  }

  const dateLabel = fragments.find(
    (fragment) =>
      fragment.page === sectionHeader.page &&
      fragment.text === "Date/time:" &&
      fragment.y < addressLabel.y,
  );

  const floor = dateLabel ? dateLabel.y : Number.NEGATIVE_INFINITY;

  const lines = [valueColumn, ...valuesBelow(fragments, valueColumn)]
    .filter((fragment) => fragment.y > floor)
    .map((anchor) =>
      withRowContinuation(fragments, anchor, nextColumnX(fragments, addressLabel, valueColumn)),
    );

  return untilRemarks(lines);
}

/**
 * Where the column to the RIGHT of the address begins, or +infinity.
 *
 * The form puts `Remarks:` there, on the same row as `Address:`, and that
 * column carries the sender's own notes. It is the boundary a row may not be
 * joined across: without it, "62223 SAINT LAURENT BLANGY" would be read as
 * "62223 SAINT LAURENT BLANGY Loading Ref: 93165142".
 *
 * Taken from the label row rather than named, so a form that calls that column
 * something else still bounds the address correctly.
 */
function nextColumnX(
  fragments: readonly Fragment[],
  addressLabel: Fragment,
  valueColumn: Fragment,
): number {
  const next = fragments
    .filter(
      (fragment) =>
        fragment.page === addressLabel.page &&
        Math.abs(fragment.y - addressLabel.y) <= ROW_TOLERANCE &&
        fragment.x > valueColumn.x + COLUMN_TOLERANCE,
    )
    .sort((left, right) => left.x - right.x)[0];

  return next ? next.x : Number.POSITIVE_INFINITY;
}

/**
 * One printed line: the anchor plus whatever continues it on the same row.
 *
 * The result is a synthetic fragment carrying the anchor's own position, so
 * everything downstream — the ordering, the `Date/time:` floor, the remarks
 * cut — keeps working on it exactly as it did on the anchor.
 */
function withRowContinuation(
  fragments: readonly Fragment[],
  anchor: Fragment,
  boundaryX: number,
): Fragment {
  const continuation = valuesRightOf(fragments, anchor).filter(
    (fragment) => fragment.x < boundaryX,
  );

  if (continuation.length === 0) {
    return anchor;
  }

  return { ...anchor, text: joinText([anchor, ...continuation]) };
}

/**
 * A LABELLED line: `Loading Ref: NUT35/149911`, `Opening times: 08:00`.
 *
 * The label is short and the colon is followed by a space, which is what the
 * form uses everywhere it names something — and what an address never does. A
 * street may hold a number, a comma or a slash; none of them holds a label.
 *
 * ── A LABEL IS WORDS, NOT A CODE ────────────────────────────────────────────
 * The name before the colon carries NO DIGIT. Every label this form prints is
 * made of words — `Remarks`, `Loading Ref`, `Opening times`, `Date/time`,
 * `Cargo (stc)` — while a real address line begins with a customer's site code:
 *
 *     BE01: Exxonmobil
 *
 * Without the digit rule that company line looked like a label, the address
 * block was cut off directly under the bracketed postcode, and a document
 * naming its destination plainly was reported unreadable.
 */
const LABELLED_LINE = /^[A-Za-z][^:\d]{0,30}:\s/;

/**
 * Operational instructions the form prints INSIDE the address column.
 *
 * ── WHY THE LABEL RULE DOES NOT CATCH THESE ─────────────────────────────────
 * `untilRemarks` ends the address at the first labelled line, which is how
 * every note the sender adds is normally excluded. This one carries no label
 * and no colon:
 *
 *     Ks Project Logistics
 *     Graanweg 17,
 *     Moerdijk, 4782 PP ,
 *     Netherlands
 *     ADD DELIVERY TO REMARKS      <- an instruction, not part of the address
 *
 * ── AND WHY GEOMETRY DOES NOT EITHER ────────────────────────────────────────
 * Measured on the real document rather than assumed: the instruction is at
 * x=97.5, the SAME column as the company, the street and the country. It is not
 * in the Remarks column, so `nextColumnX` cannot bound it away. It is separated
 * only by a blank line, and treating a wider line gap as "the address ended"
 * would silently drop real lines from any layout that spaces its rows
 * differently.
 *
 * So it is excluded by what it SAYS. The pattern is a family rather than one
 * literal — `ADD COLLECTION TO REMARKS` is the same instruction about the other
 * leg — and it can match no address line: no company, street, city or country
 * is an instruction to put something in the remarks.
 *
 * A line matching this is DROPPED rather than ending the block, so an
 * instruction printed between two address lines cannot truncate the address.
 */
const OPERATIONAL_INSTRUCTIONS: readonly RegExp[] = [
  /^ADD\s+[A-Z]+\s+TO\s+REMARKS$/,
];

/** Whether this line is an instruction to the operator rather than an address. */
function isOperationalInstruction(text: string): boolean {
  const normalized = text.trim().replace(/\s+/g, " ").toUpperCase();

  return OPERATIONAL_INSTRUCTIONS.some((pattern) => pattern.test(normalized));
}

/**
 * The address, without the free text printed underneath it.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * The address column does not end at the address. Below it the form prints the
 * sender's own notes — a loading reference, then whatever the shipper wrote:
 *
 *     F - 62126 Wimille          <- the address ends here
 *     Loading Ref: NUT35/149911  <- a labelled reference
 *     pls fix papers on the last pallet   <- free text
 *
 * Read to the bottom of the column, the last line of one real order is
 * "pls fix papers on the last pallet", and a rule that takes the last line
 * stored that as the destination city. It is not a city, it is a note to the
 * driver, and no reading of an address should ever reach it.
 *
 * The FIRST labelled line closes the block. That is the form's own structure
 * rather than a judgement about the words: everything the sender adds below an
 * address is introduced by a label, and everything above one is the address.
 * ────────────────────────────────────────────────────────────────────────────
 */
function untilRemarks(lines: readonly Fragment[]): Fragment[] {
  const firstRemark = lines.findIndex((fragment) =>
    LABELLED_LINE.test(fragment.text.trim()),
  );

  const address = firstRemark === -1 ? [...lines] : lines.slice(0, firstRemark);

  return address.filter(
    (fragment) => !isOperationalInstruction(fragment.text),
  );
}

/**
 * Country from the explicit line when the document prints one, otherwise from
 * the postcode prefix.
 *
 * Both are needed: three of the four fixture addresses carry a country line and
 * one does not, so neither source alone covers the documents we actually
 * receive. The explicit line wins because it is what the document states.
 *
 * The candidate line is only accepted when it names a country we know. The
 * fixtures put remarks in that same column — `Loading Ref: 11554650` sits
 * directly below the country on `2pages.pdf` — so an unchecked "next line"
 * would have stored a reference number as a country.
 */
function resolveCountry(prefix: string, next: Fragment | null): string {
  const stated = next ? countryFromName(next.text) : null;

  if (stated) {
    return stated;
  }

  const derived = COUNTRY_BY_POSTCODE_PREFIX[prefix.toUpperCase()];

  if (!derived) {
    throw missingField(
      "destinationCountry",
      `The address states no country and the postcode prefix "${prefix}" is not in the country mapping.`,
    );
  }

  return derived;
}

/**
 * Whether this block genuinely names no place, as opposed to one this parser
 * failed to read.
 *
 * ── WHY THE DISTINCTION HAS TO BE NARROW ────────────────────────────────────
 * "No city" is a quiet answer: the Trip imports and somebody types the address
 * in later. "Unreadable" is a loud one: the order is refused and a person looks
 * at the document. Getting the two the wrong way round is expensive in both
 * directions — a silent import of a destination the parser merely could not
 * parse would put a Trip on the planning with no address and no warning, and
 * that is exactly how the last three address bugs would have gone unnoticed.
 *
 * ── THE TEST IT APPLIES ─────────────────────────────────────────────────────
 * Only the shape `readBracketedPostcode` already recognises qualifies: the
 * block must OPEN with the bracketed postcode and hold a full address. Within
 * that shape, every line from the city position onward is examined, and the
 * block states a place if ANY of them still holds letters once its postcode has
 * been removed:
 *
 *   `8700`               -> nothing left     -> states no place
 *   `be-8580 Avelgem`    -> `Avelgem`        -> states a place, unread: REFUSE
 *   `9160 9160 Lokeren`  -> `Lokeren`        -> states a place, unread: REFUSE
 *
 * The company and the street are never examined, because the position rule puts
 * them before the city — the same rule that stops `readBracketedPostcode`
 * reading a company name as a destination.
 *
 * A country alone is not a place either: `extractAddress` already refuses a
 * block whose only candidate is a country, and that refusal is louder and more
 * specific than this one, so it keeps its own message.
 */
function statesNoPlace(block: readonly Fragment[]): boolean {
  if (
    block.length < MINIMUM_ADDRESS_LINES ||
    !BRACKETED_POSTCODE.test(block[0].text.trim())
  ) {
    return false;
  }

  const candidates = block.slice(MINIMUM_ADDRESS_LINES - 1);
  // No country: the question here is only whether letters remain, and a name
  // keeps its letters whether or not a code is set aside from it.
  const context: CityLineContext = {
    ownPostcode: bracketedPostcodeOf(block),
    country: null,
  };

  return candidates.every((fragment) => {
    const withoutPostcode = cityWithoutPostcode(fragment.text.trim(), context);

    return !/[A-Za-z]/.test(withoutPostcode);
  });
}
