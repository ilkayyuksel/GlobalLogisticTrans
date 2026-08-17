"use client";

import type { Trip } from "@/lib/api/types";
import { useLanguage, useTranslation } from "@/lib/i18n/language-provider";
import { sectionLabel } from "@/lib/ritten/date-labels";
import { isToday } from "@/lib/calendar/calendar-dates";
import type { RittenView } from "@/lib/ritten/period";
import { RittenTable, type RittenTableProps } from "./ritten-table";

/**
 * One date, its count, and the Trips planned for it.
 *
 * The same section serves all three views — only its heading differs, because a
 * day inside a week reads as "Maandag 10 augustus" while the Day view's own
 * heading carries the year. The Trips underneath are the same table either way,
 * which is what keeps the three views one product rather than three.
 *
 * A heading is a button in the week and month views: seeing a busy day and
 * wanting only that day is one thought, so it is one click.
 */
export function DateSection({
  view,
  date,
  trips,
  onOpenDay,
  ...table
}: Omit<RittenTableProps, "trips"> & {
  view: RittenView;
  /** Null for the section holding Trips that have no planning date. */
  date: string | null;
  trips: readonly Trip[];
  onOpenDay: (date: string) => void;
}) {
  const t = useTranslation();
  const { language } = useLanguage();

  /*
   * A Trip with no planning date belongs to no day. It is shown under its own
   * heading rather than being placed on an invented day, and the section is not
   * clickable: there is no day to open.
   */
  const heading =
    date === null ? t("ritten.section.unscheduled") : sectionLabel(view, date, language);
  const countLabel = `${trips.length} ${t(
    trips.length === 1 ? "ritten.trips.one" : "ritten.trips.other",
  )}`;

  return (
    <section className="rounded-lg border border-border bg-card">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
        {/* No day to open when the section is the unscheduled work. */}
        {view === "day" || date === null ? (
          <h2 className="text-base font-semibold text-foreground">{heading}</h2>
        ) : (
          <h2 className="text-base font-semibold">
            <button
              type="button"
              onClick={() => onOpenDay(date)}
              className="text-foreground hover:text-primary hover:underline"
            >
              {heading}
            </button>
          </h2>
        )}

        <p className="text-sm text-secondary">
          {countLabel}
          {date !== null && isToday(date) ? (
            <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-semibold uppercase text-primary">
              {t("ritten.nav.today")}
            </span>
          ) : null}
        </p>
      </header>

      {trips.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted">
          {t("ritten.empty.title")}
        </p>
      ) : (
        <RittenTable trips={trips} {...table} />
      )}
    </section>
  );
}
