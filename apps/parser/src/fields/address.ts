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
export const POSTCODE_LINE = /^([A-Z]{1,2})-(\d{4,5})\s+(.+)$/;

/**
 * `NNNN City` — the same line without its country prefix.
 *
 * A real order prints `2040 Antwerpen`. It is accepted ONLY when the country
 * can be established from evidence elsewhere in the document; see
 * `countryForBarePostcode`. On its own it says nothing about which country a
 * four-digit postcode belongs to, and guessing would be an invention.
 */
const BARE_POSTCODE_LINE = /^(\d{4,5})\s+([A-Za-z].*)$/;

export interface ExtractedAddress {
  readonly destinationCity: string;
  readonly destinationCountry: string;
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
    readBarePostcode(block, fragments);

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
  readonly country: string;
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

    // The line above must be a plain city, not another country and not a line
    // that already carries a postcode — those are the normal form, handled
    // above, and reaching them here would mean something is wrong.
    if (
      cityLine.length === 0 ||
      countryFromName(cityLine) !== null ||
      POSTCODE_LINE.test(cityLine) ||
      BARE_POSTCODE_LINE.test(cityLine)
    ) {
      return null;
    }

    return { city: cityLine, country, lastLineIndex: index };
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
 * Without such a line the address stays unreadable, and the order is refused.
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
    const country = countryForBarePostcode(postcode, fragments);

    if (!country) {
      return null;
    }

    return { city, country, lastLineIndex: index };
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
  const place =
    readPrefixedPostcode(block) ??
    readCountryLine(block) ??
    readBarePostcode(block, fragments);

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

  return [valueColumn, ...valuesBelow(fragments, valueColumn)].filter(
    (fragment) => fragment.y > floor,
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
