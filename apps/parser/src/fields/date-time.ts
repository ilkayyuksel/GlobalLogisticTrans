import { ExtractionError, missingField } from "../errors";
import { Fragment } from "../text/extract";
import { valuesRightOf } from "../text/normalize";

/**
 * Planning date and times, from the `Date/time:` line of the address section.
 *
 * Two shapes occur, both in real orders:
 *
 *   Date/time: 22/05/2025 10:00 till 10:00   a window
 *   Date/time: 22/05/2025 08:00 till 12:00   a window
 *   Date/time: 21/08/2026 15:00              one moment
 *
 * A single timestamp is an appointment rather than a window, and it is read as
 * a window of zero length — start and end both 15:00 — which is exactly what
 * the orders that print `08:00 till 08:00` already say in the other spelling.
 * An end time is never invented, and it is never left absent either: a Trip
 * whose end is unknown cannot be planned against, while one whose end equals
 * its start states the appointment truthfully.
 *
 * Every other date on the page is voyage information — `Estimated Closing`,
 * `Estimated Sailing`, `Estimated availability`, `Valid through` — and the
 * document header carries its own creation stamp. `parserLayouts.md` is
 * explicit that all of those are ignored, so this reads the labelled line only
 * and never scans the page for something date-shaped.
 *
 * Voyage times print a ` hrs` suffix (`06:00 hrs`) which this line never uses,
 * so even a misdirected match would not be mistaken for a trip time.
 */

const DATE_TIME_LABEL = "Date/time:";

const DATE_TIME_VALUE =
  /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}:\d{2})(?:\s+till\s+(\d{2}:\d{2}))?)?/;

/** A second clock time where only one was expected. See the ambiguity guard. */
const ANY_TIME = /\d{2}:\d{2}/;

export interface ExtractedDateTime {
  readonly date: string;
  readonly startTime: string | null;
  readonly endTime: string | null;
  readonly rawDate: string;
}

export function extractDateTime(
  fragments: readonly Fragment[],
  sectionHeader: Fragment,
): ExtractedDateTime {
  const label = fragments.find(
    (fragment) =>
      fragment.page === sectionHeader.page &&
      fragment.text === DATE_TIME_LABEL &&
      fragment.y < sectionHeader.y,
  );

  if (!label) {
    throw missingField(
      "date",
      `No '${DATE_TIME_LABEL}' line was found under '${sectionHeader.text}'.`,
    );
  }

  const value = valuesRightOf(fragments, label)[0];

  if (!value) {
    throw missingField("date", `'${DATE_TIME_LABEL}' has no value beside it.`);
  }

  const match = DATE_TIME_VALUE.exec(value.text);

  if (!match) {
    throw new ExtractionError(
      "INVALID_DATE_TIME",
      `'${DATE_TIME_LABEL}' does not have the expected 'DD/MM/YYYY[ HH:mm[ till HH:mm]]' shape: "${value.text}".`,
      ["date"],
    );
  }

  const [, day, month, year, startTime, endTime] = match;

  /*
   * Two times with no `till` between them mean nothing definite: which is the
   * start and which is the end is the document's to say, not ours to assume.
   * Reading the first and dropping the second would silently discard half of
   * what the order stated, so the line is refused instead — the same refusal
   * any other unreadable Date/time gets.
   */
  if (startTime && !endTime && ANY_TIME.test(value.text.slice(match[0].length))) {
    throw new ExtractionError(
      "INVALID_DATE_TIME",
      `'${DATE_TIME_LABEL}' states more than one time without 'till', so the start and the end cannot be told apart: "${value.text}".`,
      ["date"],
    );
  }

  const date = `${year}-${month}-${day}`;

  assertRealCalendarDate(date, value.text);

  return {
    date,
    startTime: startTime ?? null,
    endTime: endTime ?? startTime ?? null,
    rawDate: value.text,
  };
}

/**
 * `31/02/2025` matches the pattern but is not a day.
 *
 * Checked by round-tripping through UTC so the result cannot shift with the
 * machine's timezone — a date that silently moves by one day would misplace the
 * whole trip in the planning.
 */
function assertRealCalendarDate(date: string, raw: string): void {
  const parsed = new Date(`${date}T00:00:00.000Z`);

  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new ExtractionError(
      "INVALID_DATE_TIME",
      `"${raw}" is not a real calendar date.`,
      ["date"],
    );
  }
}
