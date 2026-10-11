"use client";

import { RouteMatchSection } from "@/components/pricing/route-match-section";
import type { Trip } from "@/lib/api/types";
import { useTranslation } from "@/lib/i18n/language-provider";

/**
 * Which configured route — and which Combination — the stored price of one
 * group member came from.
 *
 * Shown beside each leg in the group view, from the Trip's own stored pricing
 * (`trip.pricing.routeMatch`): the selection the calculation recorded, never a
 * Combination chosen again for display. A member that is not CLOSED has no
 * current price, so it has no current match to show either.
 */
export function GroupMemberPricing({ trip }: { trip: Trip }) {
  const t = useTranslation();

  if (trip.status !== "CLOSED") {
    return <p className="mt-2 text-xs text-muted">{t("ritten.group.pricing.notCurrent")}</p>;
  }

  if (!trip.pricing) {
    return <p className="mt-2 text-xs text-muted">{t("ritten.group.pricing.none")}</p>;
  }

  // A backend older than the record sends none: nothing to say rather than a guess.
  if (!trip.pricing.routeMatch) {
    return null;
  }

  return (
    <div className="-mx-5 mt-1">
      <RouteMatchSection routeMatch={trip.pricing.routeMatch} />
    </div>
  );
}
