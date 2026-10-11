"use client";

import { useTranslation } from "@/lib/i18n/language-provider";
import type { TranslationKey } from "@/lib/i18n/translations";
import { cn } from "@/lib/cn";

export type StatusFilter = "" | "active" | "inactive";

export const STATUS_FILTER_VALUES: readonly StatusFilter[] = ["", "active", "inactive"];

/**
 * Search box and active/inactive filter, shared by the vehicle and the driver
 * list. The labels are the caller's, so each list keeps its own wording.
 */
export function FleetListFilters({
  idPrefix,
  search,
  onSearchChange,
  status,
  onStatusChange,
  labels,
}: {
  idPrefix: string;
  search: string;
  onSearchChange: (value: string) => void;
  status: StatusFilter;
  onStatusChange: (value: StatusFilter) => void;
  labels: {
    search: TranslationKey;
    searchPlaceholder: TranslationKey;
    status: TranslationKey;
    all: TranslationKey;
    active: TranslationKey;
    inactive: TranslationKey;
  };
}) {
  const t = useTranslation();
  const choices: readonly { value: StatusFilter; labelKey: TranslationKey }[] = [
    { value: "", labelKey: labels.all },
    { value: "active", labelKey: labels.active },
    { value: "inactive", labelKey: labels.inactive },
  ];

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <div className="min-w-64 flex-1">
        <label
          htmlFor={`${idPrefix}-search`}
          className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted"
        >
          {t(labels.search)}
        </label>
        <input
          id={`${idPrefix}-search`}
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={t(labels.searchPlaceholder)}
          className="w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground placeholder:text-muted"
        />
      </div>

      <div
        role="radiogroup"
        aria-label={t(labels.status)}
        className="inline-flex rounded-md border border-border bg-card p-0.5"
      >
        {choices.map((choice) => (
          <button
            key={choice.value === "" ? "all" : choice.value}
            type="button"
            role="radio"
            aria-checked={status === choice.value}
            onClick={() => onStatusChange(choice.value)}
            className={cn(
              "rounded px-3 py-1.5 text-sm font-medium",
              status === choice.value
                ? "bg-primary text-white"
                : "text-secondary hover:bg-hover hover:text-foreground",
            )}
          >
            {t(choice.labelKey)}
          </button>
        ))}
      </div>
    </div>
  );
}
