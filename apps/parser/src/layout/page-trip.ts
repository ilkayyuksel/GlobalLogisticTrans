import {
  ExtractedAddress,
  extractAddress,
  extractStartpointAddress,
} from "../fields/address";
import { extractBookingAndDirection } from "../fields/booking";
import {
  extractContainerNumber,
  extractContainerType,
} from "../fields/container";
import { ExtractedDateTime, extractDateTime } from "../fields/date-time";
import { extractTerminal } from "../fields/terminal";
import { missingField } from "../errors";
import { Fragment } from "../text/extract";
import { findAllMatching, findLabel, fragmentsOnPage } from "../text/normalize";
import { ParsedTrip } from "../types";

/**
 * One page of a Eucon order becomes one ParsedTrip.
 *
 * All three layouts reduce to this. A single collection is one trip on page 1;
 * a combination is one trip on each of its two pages. Writing it once means the
 * layouts differ only in WHICH pages to read, never in how a trip is read — so
 * a fix to a field rule cannot apply to one layout and miss another.
 */

/** The section headers that introduce a trip's address block. */
const ADDRESS_SECTIONS = /^(LOADING|DELIVERY)\s+\d+:$/;

/** Section headers worth reporting for diagnostics. */
const SECTION_HEADER = /^[A-Z][A-Z /]+:$/;

export function extractTripFromPage(
  fragments: readonly Fragment[],
  page: number,
  groupKey: string | null,
): ParsedTrip {
  const pageFragments = fragments.filter((fragment) => fragment.page === page);

  const booking = extractBookingAndDirection(pageFragments);
  const containerType = extractContainerType(pageFragments);
  const containerNumber = extractContainerNumber(pageFragments);

  const { address, dateTime, sectionLabel } = readDestination(
    fragments,
    pageFragments,
    page,
  );
  const terminal = extractTerminal(pageFragments);

  const matchedLabels = [
    ...booking.matchedLabels,
    "Cntr type:",
    ...(containerNumber ? ["Container:"] : []),
    sectionLabel,
    "Address:",
    "Date/time:",
    ...(terminal ? [terminal.matchedLabel] : []),
  ];

  return {
    bookingNumber: booking.bookingNumber,
    containerType,
    containerNumber,
    terminal: terminal ? terminal.terminalKey : null,
    destinationCity: address.destinationCity,
    destinationCountry: address.destinationCountry,
    date: dateTime.date,
    startTime: dateTime.startTime,
    endTime: dateTime.endTime,
    direction: booking.direction,
    groupKey,
    raw: {
      rawAddress: address.rawAddress,
      rawTerminal: terminal ? terminal.rawTerminal : null,
      rawDate: dateTime.rawDate,
      rawBooking: booking.rawBooking,
      matchedLabels,
      sections: {
        page,
        addressSection: address.section,
        detected: detectedSections(pageFragments),
      },
    },
  };
}

/**
 * Where a trip goes, and when — from the best source the document offers.
 *
 * ── THE ORDER IS THE RULE ───────────────────────────────────────────────────
 * A numbered `LOADING n:` / `DELIVERY n:` section is the authoritative
 * statement of a trip's destination, and it is always preferred. The two
 * fallbacks exist because real orders do not always put one on the page that
 * carries the booking:
 *
 *   1. the section on THIS page                    — every ordinary order
 *   2. the section on the document's OTHER page    — one real order prints its
 *      voyage block on page 1 and its LOADING 1 section, with the pickup
 *      address AND the Date/time, on page 2
 *   3. the `Startpoint:` block on this page        — last resort, address only
 *
 * Order matters more than any single rule here. On an ordinary order
 * `Startpoint:` names the TERMINAL — `PSA Quay 869 … BE-2040 Antwerp` — so
 * consulting it before a real section would quietly replace `Dourges` with
 * `Antwerp` on documents that parse correctly today. It is reached only when
 * the document states no numbered section at all.
 *
 * Nothing here loosens what an address may look like: each source is read with
 * the same rules, and a document matching none of them is still refused.
 * ────────────────────────────────────────────────────────────────────────────
 */
function readDestination(
  fragments: readonly Fragment[],
  pageFragments: readonly Fragment[],
  page: number,
): {
  address: ExtractedAddress;
  dateTime: ExtractedDateTime;
  sectionLabel: string;
} {
  const ownSection = findAllMatching(pageFragments, ADDRESS_SECTIONS)[0];

  if (ownSection) {
    return {
      address: extractAddress(pageFragments, ownSection),
      dateTime: extractDateTime(pageFragments, ownSection),
      sectionLabel: ownSection.text,
    };
  }

  const elsewhere = findAllMatching(fragments, ADDRESS_SECTIONS).find(
    (section) => section.page !== page,
  );

  if (elsewhere) {
    // The address and the times are read from the SAME page, so the two never
    // describe different stops.
    const otherPage = fragmentsOnPage(fragments, elsewhere.page);

    return {
      address: extractAddress(otherPage, elsewhere),
      dateTime: extractDateTime(otherPage, elsewhere),
      sectionLabel: elsewhere.text,
    };
  }

  const startpoint = extractStartpointAddress(pageFragments);

  if (startpoint) {
    const anchor = findLabel(pageFragments, "Startpoint:");

    return {
      address: startpoint,
      // Still the labelled line, never a date found by scanning: the page also
      // carries sailing and closing dates, which are not when a truck drives.
      dateTime: extractDateTime(pageFragments, anchor as Fragment),
      sectionLabel: "Startpoint:",
    };
  }

  throw missingField(
    "destinationCity",
    `Page ${page} has no 'LOADING n:' or 'DELIVERY n:' section and no readable 'Startpoint:' address, so it states no destination.`,
  );
}

export function detectedSections(fragments: readonly Fragment[]): string[] {
  const headers = findAllMatching(fragments, SECTION_HEADER).map(
    (fragment) => fragment.text,
  );

  return [...new Set(headers)].sort();
}
