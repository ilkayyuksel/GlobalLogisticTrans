"use client";

import { RITTEN_VIEWS, type RittenView } from "@/lib/ritten/period";
import { useTranslation } from "@/lib/i18n/language-provider";
import { cn } from "@/lib/cn";

/**
 * Dag | Week | Maand.
 *
 * All three are lists of the same Trips over a different range of dates. The
 * control is a radio group rather than three buttons because exactly one is
 * always chosen, and a screen reader should say so.
 */
const LABEL_KEYS = {
  day: "ritten.view.day",
  week: "ritten.view.week",
  month: "ritten.view.month",
} as const;

export function ViewSwitcher({
  view,
  onChange,
}: {
  view: RittenView;
  onChange: (view: RittenView) => void;
}) {
  const t = useTranslation();

  return (
    <div
      role="radiogroup"
      aria-label={t("ritten.view.legend")}
      className="inline-flex rounded-md border border-border bg-card p-0.5"
    >
      {RITTEN_VIEWS.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={view === option}
          onClick={() => onChange(option)}
          className={cn(
            "rounded px-3 py-1.5 text-sm font-medium",
            view === option
              ? "bg-primary text-white"
              : "text-secondary hover:bg-hover hover:text-foreground",
          )}
        >
          {t(LABEL_KEYS[option])}
        </button>
      ))}
    </div>
  );
}
