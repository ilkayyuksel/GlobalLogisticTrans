/**
 * The day a Cost Confirmation's Remarks name with `dd DD/MM` — `dd 26/10` —
 * the day the cost was incurred, when Eucon writes one (owner, October 2026).
 *
 * ── A FALLBACK, NEVER THE FIRST ANSWER ──────────────────────────────────────
 * A confirmation is matched to its Trip on the LOADING / DELIVERY date it
 * prints (`transportDate`). This day is only consulted when that finds no
 * Trip — CC 4261544/4261545 print a loading window of 27/10 while their
 * Remarks say `dd 26/10`, the day the transport ran.
 *
 * ── NO YEAR IS GUESSED ──────────────────────────────────────────────────────
 * `dd 26/10` prints no year, so it is placed beside the confirmation's own
 * transport date: in that year, the year before or the year after, whichever
 * lies within a week of it (`dd 31/12` beside a loading date of 02/01 is the
 * previous year). No such year, or more than one, and the day is not read.
 * A year printed with it (`dd 26/10/2026`) is taken as printed, and held to
 * the same week.
 *
 * Two different `dd` days in one Remarks name no single day: nothing is read.
 */

/** `dd 26/10`, `dd. 26-10`, `DD 26/10/2026`: the marker, a day and a month, perhaps a year. */
const DD_DATE = /\bdd\.?\s*(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}|\d{2}))?(?!\d)/gi;

/** How far the Remarks' day may lie from the transport date it is read beside. */
const MAX_DISTANCE_DAYS = 7;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const CENTURY = 2000;

/**
 * The ISO day the Remarks name, read beside `transportDate` (ISO); null when
 * they name none, several, an impossible day, or one no year makes near.
 */
export function remarksDateOf(remarks: string | null, transportDate: string | null): string | null {
  if (remarks === null || transportDate === null) {
    return null;
  }

  const days = new Set<string>();

  for (const match of remarks.matchAll(DD_DATE)) {
    const day = resolve(Number(match[1]), Number(match[2]), match[3], transportDate);

    if (day === null) {
      return null;
    }

    days.add(day);
  }

  return days.size === 1 ? [...days][0] : null;
}

function resolve(day: number, month: number, printedYear: string | undefined, transportDate: string): string | null {
  const anchor = Date.parse(`${transportDate}T00:00:00.000Z`);
  const anchorYear = new Date(anchor).getUTCFullYear();
  const years =
    printedYear === undefined
      ? [anchorYear - 1, anchorYear, anchorYear + 1]
      : [printedYear.length === 2 ? CENTURY + Number(printedYear) : Number(printedYear)];
  const near = years
    .map((year) => toIsoDay(year, month, day))
    .filter((iso): iso is string => iso !== null)
    .filter((iso) => Math.abs(Date.parse(`${iso}T00:00:00.000Z`) - anchor) <= MAX_DISTANCE_DAYS * MILLISECONDS_PER_DAY);

  return near.length === 1 ? near[0] : null;
}

/** `YYYY-MM-DD` for a real calendar day; null for 31/02 and the like. */
function toIsoDay(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));

  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}
