"use client";

import { Spinner } from "@/components/ui/spinner";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { RittenCounts } from "@/lib/api/ritten";
import type { TripStatus } from "@/lib/api/types";
import { cn } from "@/lib/cn";

/**
 * Open · Afgewerkt · Totaal for the selected period.
 *
 * EVERY FIGURE IS THE BACKEND'S COUNT over the whole period, not a tally of the
 * rows on screen — a paged list would otherwise report "8 open" when the period
 * holds two hundred.
 *
 * They double as the status filter, which is how a planner actually uses them:
 * seeing "12 open" and wanting to see those twelve is one thought, so it should
 * be one click.
 */
export function RittenCounters({
  counts,
  isLoading,
  status,
  onStatusChange,
}: {
  counts: RittenCounts | null;
  isLoading: boolean;
  status: TripStatus | "";
  onStatusChange: (status: TripStatus | "") => void;
}) {
  const t = useTranslation();

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Counter
        label={t("ritten.counters.open")}
        value={counts ? counts.open : null}
        isLoading={isLoading}
        isActive={status === "OPEN"}
        onSelect={() => onStatusChange(status === "OPEN" ? "" : "OPEN")}
      />
      <Counter
        label={t("ritten.counters.closed")}
        value={counts ? counts.closed : null}
        isLoading={isLoading}
        isActive={status === "CLOSED"}
        onSelect={() => onStatusChange(status === "CLOSED" ? "" : "CLOSED")}
      />
      <Counter
        label={t("ritten.counters.total")}
        value={counts ? counts.total : null}
        isLoading={isLoading}
        isActive={status === ""}
        onSelect={() => onStatusChange("")}
      />
    </div>
  );
}

function Counter({
  label,
  value,
  isLoading,
  isActive,
  onSelect,
}: {
  label: string;
  value: number | null;
  isLoading: boolean;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={isActive}
      onClick={onSelect}
      className={cn(
        "rounded-lg border bg-card px-4 py-3 text-left",
        isActive ? "border-primary ring-1 ring-primary" : "border-border hover:bg-hover",
      )}
    >
      <span className="block text-xs font-medium uppercase tracking-wide text-muted">
        {label}
      </span>
      <span className="mt-1 block text-2xl font-semibold tabular-nums text-foreground">
        {isLoading || value === null ? <Spinner label={label} /> : value}
      </span>
    </button>
  );
}
