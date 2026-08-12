import { ExtractionError, missingField } from "../errors";
import { Fragment } from "../text/extract";
import { findStartingWith, valuesRightOf } from "../text/normalize";
import { Direction } from "../types";

/**
 * Booking number and trip direction.
 *
 * Both come from one line, which the fixtures show in this form:
 *
 *   COLLECTION Bookings nr/Trip nr: ANRDUB2602247 /67036944
 *   DELIVERY Bookings nr/Trip nr: DUBANR2598395 /66906824
 *
 * The trip number after the slash is Eucon's internal reference and is
 * deliberately discarded — `parserLayouts.md` says to store the booking only.
 */

const HEADER_PATTERN =
  /^(COLLECTION|DELIVERY)\s+Bookings nr\/Trip nr:\s*(\S+)\s*\/\s*(\S+)/;

const BOOKING_LABEL = "Booking no:";

export interface BookingAndDirection {
  readonly bookingNumber: string;
  readonly direction: Direction;
  readonly rawBooking: string;
  readonly matchedLabels: string[];
}

export function extractBookingAndDirection(
  fragments: readonly Fragment[],
): BookingAndDirection {
  const header = findStartingWith(fragments, "COLLECTION Bookings nr/Trip nr:")
    ?? findStartingWith(fragments, "DELIVERY Bookings nr/Trip nr:");

  if (!header) {
    throw missingField(
      "bookingNumber",
      "No 'Bookings nr/Trip nr:' line was found, so neither the booking number nor the trip direction can be read.",
    );
  }

  const match = HEADER_PATTERN.exec(header.text);

  if (!match) {
    throw missingField(
      "bookingNumber",
      `The 'Bookings nr/Trip nr:' line does not have the expected shape: "${header.text}".`,
    );
  }

  const [, direction, bookingNumber] = match;
  const matchedLabels = ["Bookings nr/Trip nr:"];

  assertAgreesWithBookingNoField(fragments, bookingNumber, matchedLabels);

  return {
    bookingNumber,
    direction: direction as Direction,
    rawBooking: header.text,
    matchedLabels,
  };
}

/**
 * The document states the booking twice: in the header line and in a
 * `Booking no:` field. When both are present they must agree.
 *
 * A mismatch is refused rather than resolved. Picking one would be a guess
 * about which half of a self-contradicting document is right, and a wrong
 * booking number attaches the trip to the wrong transport order — the one
 * error the whole import cannot recover from, because every later match on
 * `UPDATE:` and `CANCEL:` uses it.
 *
 * The field is absent on some pages, which is not an error; only disagreement
 * is.
 */
function assertAgreesWithBookingNoField(
  fragments: readonly Fragment[],
  bookingNumber: string,
  matchedLabels: string[],
): void {
  const label = fragments.find((fragment) => fragment.text === BOOKING_LABEL);

  if (!label) {
    return;
  }

  const stated = valuesRightOf(fragments, label)[0]?.text
    ?? belowInSameColumn(fragments, label);

  if (!stated) {
    return;
  }

  matchedLabels.push(BOOKING_LABEL);

  if (stated !== bookingNumber) {
    throw new ExtractionError(
      "INCONSISTENT_BOOKING_NUMBER",
      `The document states two different booking numbers: "${bookingNumber}" on the 'Bookings nr/Trip nr:' line and "${stated}" under 'Booking no:'.`,
      ["bookingNumber"],
    );
  }
}

/**
 * On the collection pages `Booking no:` sits above its value rather than
 * beside it, so the column below is checked when the row is empty.
 */
function belowInSameColumn(
  fragments: readonly Fragment[],
  label: Fragment,
): string | null {
  const candidate = fragments
    .filter(
      (fragment) =>
        fragment.page === label.page &&
        fragment.y < label.y &&
        fragment.y > label.y - 20 &&
        fragment.x > label.x,
    )
    .sort((left, right) => right.y - left.y)[0];

  return candidate?.text ?? null;
}
