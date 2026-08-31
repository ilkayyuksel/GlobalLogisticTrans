import { ExtractionError, missingField } from "../errors";
import {
  COUNTRY_BY_POSTCODE_PREFIX,
  countryFromName,
  isCountryName,
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
export const POSTCODE_LINE = /^([A-Za-z]{1,2})\s*-\s*(\d{4,5})\s+(.+)$/;

/**
 * `NNNN City` — the same line without its country prefix.
 *
 * Real orders print `2040 Antwerpen`, `3980 Tessenderlo` and `9940 Evergem,`.
 * The trailing comma is part of a comma-separated address and belongs to the
 * punctuation, not to the name.
 *
 * The number says nothing about WHICH country: 59554 is Raillencourt-Sainte-Olle
 * in France and Lippstadt in Germany. So this line yields a city, and the
 * country has to come from somewhere the document actually states it.
 */
const BARE_POSTCODE_LINE = /^(\d{4,5})[\s,]+([A-Za-z].*)$/;

/**
 * `[NNNNN]` — the customer reference the order prints above every address.
 *
 * It is the postcode again, in brackets. On most documents it is redundant; on
 * one real order it is the ONLY postcode present, which is what makes the last
 * address line identifiable as the city.
 */
const BRACKETED_POSTCODE = /^\[(\d{4,5})\]$/;

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
  readonly destinationCity: string;
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
     *   9940 Evergem,        4880 Aubel
     *   Belgium              Belgium
     *
     * The postcode is dropped rather than kept — a city is a name, and
     * "9940 Evergem" as a destination would match no configured route and read
     * as nonsense in an export. The country still comes from the word below,
     * never from the number.
     */
    const withPostcode = POSTCODE_THEN_CITY.exec(cityLine);
    const city = toCityName(withPostcode ? withPostcode[1] : cityLine);

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

    const city = cityAbove(block, index);

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
): string | null {
  for (let index = postcodeLineIndex - 1; index >= 0; index -= 1) {
    const line = toCityName(block[index].text);

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
const POSTCODE_THEN_CITY = /^(?:[A-Za-z]{1,2}\s*-\s*)?\d{4,8}[\s,]+([A-Za-z].*)$/;

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
 *   * the last line must carry no digit. A street keeps its number
 *     ("Transportstraat 6", "Rue de Kan 7"), a city does not, and refusing
 *     rather than guessing is what keeps a street out of the city field;
 *   * the block must hold a full address — the bracket, a company, a street and
 *     the city. Fewer lines than that is a truncated block, where the last line
 *     is as likely to be the street as the city, and a street read as a city
 *     would match no route and mislead an operator. Such a block is refused;
 *   * it runs last, so no document that any other rule can read ever reaches it.
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

  const lastIndex = block.length - 1;
  const lastLine = block[lastIndex].text;
  const candidate = toCityName(lastLine);

  /*
   * A country is not a city, here as everywhere else. This rule is the last
   * resort and takes the final line of the block, so without this a block
   * ending in `France` would offer the country as the destination — which is
   * exactly what the invariant at the top of this file then has to refuse.
   */
  if (candidate.length === 0 || /\d/.test(candidate) || isCountryName(candidate)) {
    return null;
  }

  /*
   * `Kallo, Belgium` on the final line is a city AND a country. The country is
   * kept rather than discarded — the document stated it plainly, and this rule
   * is the only one that would otherwise report the country as absent.
   */
  return {
    city: candidate,
    country: countryOnCityLine(lastLine),
    lastLineIndex: lastIndex,
  };
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
 */
const LABELLED_LINE = /^[A-Za-z][^:]{0,30}:\s/;

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

  return firstRemark === -1 ? [...lines] : lines.slice(0, firstRemark);
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
