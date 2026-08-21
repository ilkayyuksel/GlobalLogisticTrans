import { ExtractionError, missingField } from "../errors";
import { COUNTRY_BY_POSTCODE_PREFIX, countryFromName } from "./country";
import { Fragment } from "../text/extract";
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

/** `CC-NNNNN City` — the one line that identifies where a trip actually goes. */
export const POSTCODE_LINE = /^([A-Z]{1,2})\s*-\s*(\d{4,5})\s+(.+)$/;

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

/** `Evergem,` is the same city as `Evergem`. */
function toCityName(value: string): string {
  return value.trim().replace(/[,;]+$/, "").trim();
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

  const place =
    readPrefixedPostcode(block) ??
    readCountryLine(block) ??
    readBarePostcode(block, fragments) ??
    readBracketedPostcode(block);

  if (!place) {
    throw new ExtractionError(
      "MALFORMED_ADDRESS",
      `No readable city line was found under '${sectionHeader.text}'. Read instead: ${JSON.stringify(joinText(block))}.`,
      ["destinationCity"],
    );
  }

  return {
    destinationCity: toTitleCase(place.city.trim()),
    destinationCountry: place.country,
    rawAddress: joinText(block.slice(0, place.lastLineIndex + 1)),
    section: sectionHeader.text.replace(/:$/, ""),
  };
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
    const bare = BARE_POSTCODE_LINE.exec(cityLine);

    return {
      city: toCityName(bare ? bare[2] : cityLine),
      country,
      lastLineIndex: index,
    };
  }

  return null;
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

    return {
      city: toCityName(city),
      country: countryForBarePostcode(postcode, fragments),
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
  const candidate = toCityName(block[lastIndex].text);

  if (candidate.length === 0 || /\d/.test(candidate)) {
    return null;
  }

  return { city: candidate, country: null, lastLineIndex: lastIndex };
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
  const place =
    readPrefixedPostcode(block) ??
    readCountryLine(block) ??
    readBarePostcode(block, fragments) ??
    readBracketedPostcode(block);

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
        Math.abs(fragment.y - addressLabel.y) <= 3 &&
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

  const lines = [valueColumn, ...valuesBelow(fragments, valueColumn)].filter(
    (fragment) => fragment.y > floor,
  );

  return untilRemarks(lines);
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
