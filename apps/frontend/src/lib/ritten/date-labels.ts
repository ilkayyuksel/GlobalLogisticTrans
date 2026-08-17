import type { Language } from "@/lib/i18n/translations";
import { periodEnd, periodStart, type RittenView } from "./period";

/**
 * Date headings in the operator's own language.
 *
 * Formatting is left to `Intl` rather than to a table of month names: it
 * already knows that Dutch writes "13 augustus 2026" and Turkish writes
 * "13 Ağustos 2026", and a hand-written table would be one more thing to keep
 * correct in every language added later.
 *
 * Every call formats in UTC. A planning date is a calendar date with no
 * timezone, and letting the local one apply would shift the heading by a day
 * for anyone west of UTC.
 */

const LOCALES: Record<Language, string> = {
  nl: "nl-NL",
  tr: "tr-TR",
};

/** "Donderdag 13 augustus 2026" — the Day view's own heading. */
export function longDateLabel(isoDate: string, language: Language): string {
  return capitalize(
    format(isoDate, language, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }),
  );
}

/** "Maandag 10 augustus" — a day section inside a week. */
export function dayInWeekLabel(isoDate: string, language: Language): string {
  return capitalize(
    format(isoDate, language, {
      weekday: "long",
      day: "numeric",
      month: "long",
    }),
  );
}

/** "2 augustus 2026" — a day section inside a month. */
export function dayInMonthLabel(isoDate: string, language: Language): string {
  return capitalize(
    format(isoDate, language, { day: "numeric", month: "long", year: "numeric" }),
  );
}

/** "Augustus 2026". */
export function monthTitleLabel(isoDate: string, language: Language): string {
  return capitalize(format(isoDate, language, { month: "long", year: "numeric" }));
}

/** "10 – 16 augustus 2026", collapsing the month when both ends share one. */
export function weekRangeLabel(isoDate: string, language: Language): string {
  const first = periodStart("week", isoDate);
  const last = periodEnd("week", isoDate);
  const sameMonth = first.slice(0, 7) === last.slice(0, 7);

  const firstPart = format(first, language, {
    day: "numeric",
    ...(sameMonth ? {} : { month: "long" }),
  });
  const lastPart = format(last, language, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return `${firstPart} – ${lastPart}`;
}

/** The heading of the currently selected period, whichever view is showing. */
export function periodLabel(
  view: RittenView,
  anchor: string,
  language: Language,
): string {
  if (view === "day") {
    return longDateLabel(anchor, language);
  }

  return view === "week"
    ? weekRangeLabel(anchor, language)
    : monthTitleLabel(anchor, language);
}

/** The heading of one date section, which differs by the view it sits in. */
export function sectionLabel(
  view: RittenView,
  isoDate: string,
  language: Language,
): string {
  if (view === "day") {
    return longDateLabel(isoDate, language);
  }

  return view === "week"
    ? dayInWeekLabel(isoDate, language)
    : dayInMonthLabel(isoDate, language);
}

function format(
  isoDate: string,
  language: Language,
  options: Intl.DateTimeFormatOptions,
): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);

  if (Number.isNaN(date.getTime())) {
    return isoDate;
  }

  return date.toLocaleDateString(LOCALES[language], {
    ...options,
    timeZone: "UTC",
  });
}

/**
 * Dutch lowercases weekdays and months mid-sentence; a heading is not
 * mid-sentence. Turkish capitalises them already, so this changes nothing there.
 */
function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
