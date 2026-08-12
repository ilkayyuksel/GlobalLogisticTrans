import { extractAddress } from "../fields/address";
import { extractBookingAndDirection } from "../fields/booking";
import {
  extractContainerNumber,
  extractContainerType,
} from "../fields/container";
import { extractDateTime } from "../fields/date-time";
import { extractTerminal } from "../fields/terminal";
import { missingField } from "../errors";
import { Fragment } from "../text/extract";
import { findAllMatching } from "../text/normalize";
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

  const sectionHeader = findAllMatching(pageFragments, ADDRESS_SECTIONS)[0];

  if (!sectionHeader) {
    throw missingField(
      "destinationCity",
      `Page ${page} has no 'LOADING n:' or 'DELIVERY n:' section, so it states no destination.`,
    );
  }

  const address = extractAddress(pageFragments, sectionHeader);
  const dateTime = extractDateTime(pageFragments, sectionHeader);
  const terminal = extractTerminal(pageFragments);

  const matchedLabels = [
    ...booking.matchedLabels,
    "Cntr type:",
    ...(containerNumber ? ["Container:"] : []),
    sectionHeader.text,
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

export function detectedSections(fragments: readonly Fragment[]): string[] {
  const headers = findAllMatching(fragments, SECTION_HEADER).map(
    (fragment) => fragment.text,
  );

  return [...new Set(headers)].sort();
}
