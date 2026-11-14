"use client";

import { HoverNote } from "@/components/ui/hover-note";
import type { Trip } from "@/lib/api/types";
import { useTranslation } from "@/lib/i18n/language-provider";
import { describeSeveralCostConfirmations } from "@/lib/trips/cost-confirmation";

/**
 * A small sign beside the CC cell that a Trip has SEVERAL confirmations.
 *
 * The cell shows the latest one; this says there are more and, on hover or
 * focus, lists each with its amount, their total and what EK actually holds —
 * the total, or the recorded waiting time that takes precedence. Nothing for a
 * Trip with one or none.
 *
 * Every figure is read from the Trip the list endpoint just returned, so the
 * note is exactly as current as the row beside it and holds no state of its own.
 */
export function SeveralCostConfirmationsMarker({ trip }: { trip: Trip }) {
  const t = useTranslation();
  const note = describeSeveralCostConfirmations(
    {
      costConfirmations: trip.costConfirmations ?? [],
      costConfirmationTotal: trip.costConfirmationTotal ?? null,
      waitingTimeSupersedesCostConfirmations: trip.waitingTimeSupersedesCostConfirmations ?? false,
      ek: trip.pricing?.ek ?? null,
    },
    {
      count: t("ritten.cc.several.count"),
      total: t("ritten.cc.several.total"),
      ekContribution: t("ritten.cc.several.ek"),
      waitingTimeFirst: t("ritten.cc.several.waitingTimeFirst"),
      notPriced: t("ritten.cc.several.notPriced"),
    },
  );

  if (note === null) {
    return null;
  }

  return (
    <HoverNote label={t("ritten.cc.several.label")} note={note} showMarker={false}>
      {/* Focusable, so the note reaches a keyboard user as it does a pointer. */}
      <span
        tabIndex={0}
        role="img"
        aria-label={t("ritten.cc.several.label")}
        data-testid="several-cost-confirmations"
        className="inline-flex text-warning focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <svg viewBox="0 0 20 20" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          {/* Two stacked documents: more than one confirmation. */}
          <path d="M6 2.5h6l3 3V14H6z" />
          <path d="M4 5v12.5h8" />
        </svg>
      </span>
    </HoverNote>
  );
}
