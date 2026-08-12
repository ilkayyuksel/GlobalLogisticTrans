import { ExtractionError, missingField } from "../errors";
import { Fragment } from "../text/extract";
import { valuesRightOf } from "../text/normalize";

/**
 * Planning date and times, from the `Date/time:` line of the address section.
 *
 * The fixtures agree on one shape:
 *
 *   Date/time: 22/05/2025 10:00 till 10:00
 *   Date/time: 22/05/2025 08:00 till 12:00
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
  /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}:\d{2})\s+till\s+(\d{2}:\d{2}))?/;

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
      `'${DATE_TIME_LABEL}' does not have the expected 'DD/MM/YYYY HH:mm till HH:mm' shape: "${value.text}".`,
      ["date"],
    );
  }

  const [, day, month, year, startTime, endTime] = match;
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
