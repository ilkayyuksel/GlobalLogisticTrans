"use client";

import { useTranslation } from "@/lib/i18n/language-provider";
import type { TranslationKey } from "@/lib/i18n/translations";

/**
 * Which routes the list shows.
 *
 * Administrative progress, so an administrator working through a long price list
 * can see what is left. It filters the VIEW and nothing else: no route changes,
 * no order changes, and what the Pricing Engine reads is untouched.
 */
export const REVIEW_FILTERS = ["ALL", "TODO", "REVIEWED"] as const;

export type ReviewFilter = (typeof REVIEW_FILTERS)[number];

const FILTER_LABELS: Record<ReviewFilter, TranslationKey> = {
  ALL: "settings.pricing.routes.filter.all",
  TODO: "settings.pricing.routes.filter.todo",
  REVIEWED: "settings.pricing.routes.filter.reviewed",
};

/** Whether one configuration belongs in the current view. */
export function matchesFilter(reviewed: boolean, filter: ReviewFilter): boolean {
  return (
    filter === "ALL" ||
    (filter === "TODO" && !reviewed) ||
    (filter === "REVIEWED" && reviewed)
  );
}

/**
 * The progress line and the filter that goes with it.
 *
 * Counted by the caller from the live lists — CONFIGURATIONS, not rows, so a
 * Combination is one record however many legs it draws.
 */
export function RouteReviewProgress({
  reviewedCount,
  configurationCount,
  filter,
  onFilterChange,
}: {
  reviewedCount: number;
  configurationCount: number;
  filter: ReviewFilter;
  onFilterChange: (filter: ReviewFilter) => void;
}) {
  const t = useTranslation();

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-secondary">
        <span className="font-medium text-foreground">
          {`${reviewedCount} / ${configurationCount} ${t("settings.pricing.routes.reviewedCount")}`}
        </span>
        {configurationCount - reviewedCount > 0
          ? ` — ${configurationCount - reviewedCount} ${t("settings.pricing.routes.todoCount")}`
          : ""}
      </p>

      <fieldset className="flex flex-wrap items-center gap-1">
        <legend className="sr-only">
          {t("settings.pricing.routes.filter.label")}
        </legend>
        {REVIEW_FILTERS.map((candidate) => (
          <button
            key={candidate}
            type="button"
            aria-pressed={filter === candidate}
            onClick={() => onFilterChange(candidate)}
            className={`rounded-md border px-2 py-0.5 text-xs font-medium ${
              filter === candidate
                ? "border-primary bg-primary text-white"
                : "border-border text-foreground hover:bg-hover"
            }`}
          >
            {t(FILTER_LABELS[candidate])}
          </button>
        ))}
      </fieldset>
    </div>
  );
}
