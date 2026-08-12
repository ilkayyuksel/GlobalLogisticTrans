import { ExtractionError, missingField } from "../errors";
import { COUNTRY_BY_POSTCODE_PREFIX, countryFromName } from "./country";
import { Fragment } from "../text/extract";
import { joinText, toTitleCase, valuesBelow } from "../text/normalize";

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

  const postcodeIndex = block.findIndex((fragment) =>
    POSTCODE_LINE.test(fragment.text),
  );

  if (postcodeIndex === -1) {
    throw new ExtractionError(
      "MALFORMED_ADDRESS",
      `No 'CC-postcode City' line was found under '${sectionHeader.text}'. Read instead: ${JSON.stringify(joinText(block))}.`,
      ["destinationCity"],
    );
  }

  const match = POSTCODE_LINE.exec(block[postcodeIndex].text);

  if (!match) {
    throw new ExtractionError(
      "MALFORMED_ADDRESS",
      `The postcode line could not be read: "${block[postcodeIndex].text}".`,
      ["destinationCity"],
    );
  }

  const [, prefix, , city] = match;
  const countryLine = block[postcodeIndex + 1] ?? null;
  const destinationCountry = resolveCountry(prefix, countryLine);

  return {
    destinationCity: toTitleCase(city.trim()),
    destinationCountry,
    rawAddress: joinText(addressOnly(block, postcodeIndex, countryLine)),
    section: sectionHeader.text.replace(/:$/, ""),
  };
}

/**
 * The address itself, without the lines that follow it.
 *
 * The value column keeps going after the address — `2pages.pdf` prints
 * `Loading Ref: 11554650` and a packing instruction directly underneath — and
 * those are remarks, not part of where the trip goes. The raw address ends at
 * the postcode line, or at the country line when the document prints one.
 */
function addressOnly(
  block: readonly Fragment[],
  postcodeIndex: number,
  countryLine: Fragment | null,
): Fragment[] {
  const isCountry = countryLine !== null && countryFromName(countryLine.text) !== null;

  return block.slice(0, postcodeIndex + (isCountry ? 2 : 1));
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
