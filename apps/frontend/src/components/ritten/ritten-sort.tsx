"use client";

import type { TripSortField, TripSortDirection } from "@/lib/api/trips";
import { useTranslation } from "@/lib/i18n/language-provider";
import { cn } from "@/lib/cn";

/**
 * How a day's Trips are ordered.
 *
 * ── THE SORT IS A QUERY, NOT A VIEW ─────────────────────────────────────────
 * Every choice here goes to the backend and the database orders the rows.
 * Sorting the page already in the browser would order only what is on screen
 * and quietly misrepresent every other page of the period — a planner looking
 * at "the earliest Trip of the week" would be shown the earliest of page one.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * What it does NOT change is the shape of the list: the planning date stays the
 * first ordering key, so the Day, Week and Month sections survive. This chooses
 * the order within a day — truck by truck, or as the day happens.
 */
export interface RittenSort {
  field: TripSortField;
  direction: TripSortDirection;
}

/**
 * Truck by truck, ascending — how a planner reads the day.
 *
 * The plate was ALWAYS the second ordering key before this, ahead of the time
 * and never adjustable, so the list already read this way and choosing a time
 * only ordered Trips within one truck. Making the plate a field a planner can
 * choose is what lets the other order — the day as it happens — exist at all;
 * the default is unchanged in effect.
 */
export const DEFAULT_RITTEN_SORT: RittenSort = {
  field: "licensePlate",
  direction: "asc",
};

type SortLabelKey =
  | "ritten.column.licensePlate"
  | "ritten.column.start"
  | "ritten.column.end";

/**
 * Nummerplaat, and the two times the list already offered.
 *
 * The times are kept as the two separate columns they are rather than folded
 * into one "Tijd": both are real columns of this table, a planner sorts by
 * either, and merging them would take away a choice that already existed.
 */
const FIELDS: readonly { field: TripSortField; labelKey: SortLabelKey }[] = [
  { field: "licensePlate", labelKey: "ritten.column.licensePlate" },
  { field: "startTime", labelKey: "ritten.column.start" },
  { field: "endTime", labelKey: "ritten.column.end" },
];

export function RittenSortControl({
  value,
  onChange,
}: {
  value: RittenSort;
  onChange: (sort: RittenSort) => void;
}) {
  const t = useTranslation();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted">
        {t("ritten.sort.label")}
      </span>

      <div
        role="radiogroup"
        aria-label={t("ritten.sort.label")}
        className="inline-flex rounded-md border border-border bg-card p-0.5"
      >
        {FIELDS.map(({ field, labelKey }) => (
          <button
            key={field}
            type="button"
            role="radio"
            aria-checked={value.field === field}
            onClick={() => onChange({ ...value, field })}
            className={cn(
              "rounded px-3 py-1.5 text-sm font-medium",
              value.field === field
                ? "bg-primary text-white"
                : "text-secondary hover:bg-hover hover:text-foreground",
            )}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>

      {/*
        One button rather than two radios: ascending and descending are the two
        states of one setting, and a planner flips it far more often than they
        choose between them.
      */}
      <button
        type="button"
        onClick={() =>
          onChange({
            ...value,
            direction: value.direction === "asc" ? "desc" : "asc",
          })
        }
        aria-label={
          value.direction === "asc"
            ? t("ritten.sort.ascending")
            : t("ritten.sort.descending")
        }
        title={
          value.direction === "asc"
            ? t("ritten.sort.ascending")
            : t("ritten.sort.descending")
        }
        className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-hover"
      >
        {value.direction === "asc" ? "↑" : "↓"}
      </button>
    </div>
  );
}
