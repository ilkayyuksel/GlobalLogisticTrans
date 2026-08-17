"use client";

import { useLanguage, useTranslation } from "@/lib/i18n/language-provider";
import { periodLabel } from "@/lib/ritten/date-labels";
import {
  fromMonthInputValue,
  isCurrentPeriod,
  periodStart,
  shiftPeriod,
  toMonthInputValue,
  todayAnchor,
  type RittenView,
} from "@/lib/ritten/period";

/**
 * One date navigator for all three views.
 *
 * Previous, next, "back to now" and a picker are the same four actions whichever
 * period is selected; only the step and the label differ, and both are decided
 * by `period.ts`. Three near-identical navigators would be three places to fix
 * the next time a boundary rule changes.
 *
 * The picker is a date input for Day and Week — for Week it means "any day in
 * the week I want", which is how a planner thinks — and a month input for Month.
 */
const NOW_LABEL_KEYS = {
  day: "ritten.nav.today",
  week: "ritten.nav.thisWeek",
  month: "ritten.nav.thisMonth",
} as const;

const PICKER_LABEL_KEYS = {
  day: "ritten.nav.pickDay",
  week: "ritten.nav.pickWeek",
  month: "ritten.nav.pickMonth",
} as const;

export function PeriodNav({
  view,
  anchor,
  onChange,
}: {
  view: RittenView;
  anchor: string;
  onChange: (anchor: string) => void;
}) {
  const t = useTranslation();
  const { language } = useLanguage();
  const isNow = isCurrentPeriod(view, anchor);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        aria-label={t("ritten.nav.previous")}
        onClick={() => onChange(shiftPeriod(view, anchor, -1))}
        className="rounded-md border border-border px-2.5 py-1.5 text-sm font-medium text-foreground hover:bg-hover"
      >
        ←
      </button>

      <p
        aria-live="polite"
        className="min-w-56 text-center text-sm font-semibold text-foreground"
      >
        {periodLabel(view, anchor, language)}
      </p>

      <button
        type="button"
        aria-label={t("ritten.nav.next")}
        onClick={() => onChange(shiftPeriod(view, anchor, 1))}
        className="rounded-md border border-border px-2.5 py-1.5 text-sm font-medium text-foreground hover:bg-hover"
      >
        →
      </button>

      <button
        type="button"
        onClick={() => onChange(todayAnchor())}
        disabled={isNow}
        className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {t(NOW_LABEL_KEYS[view])}
      </button>

      <label className="sr-only" htmlFor="ritten-period-picker">
        {t(PICKER_LABEL_KEYS[view])}
      </label>
      {view === "month" ? (
        <input
          id="ritten-period-picker"
          type="month"
          value={toMonthInputValue(anchor)}
          onChange={(event) => {
            const picked = fromMonthInputValue(event.target.value);

            if (picked) {
              onChange(picked);
            }
          }}
          className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
        />
      ) : (
        <input
          id="ritten-period-picker"
          type="date"
          value={view === "week" ? periodStart("week", anchor) : anchor}
          onChange={(event) => {
            if (event.target.value) {
              onChange(event.target.value);
            }
          }}
          className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
        />
      )}
    </div>
  );
}
