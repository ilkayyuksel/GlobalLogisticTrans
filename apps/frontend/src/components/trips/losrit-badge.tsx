import { Badge } from "@/components/ui/badge";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { Trip } from "@/lib/api/types";

/**
 * LOSRIT — a loose trip, as the operator classified it.
 *
 * ── IT IS NOT A STATUS ──────────────────────────────────────────────────────
 * It sits BESIDE the lifecycle badge rather than instead of it, because the two
 * answer different questions: one says what has happened to the transport, the
 * other says what kind of transport it is. A LOSRIT is OPEN, CLOSED or
 * CANCELLED like any other Trip, and it is offered exactly the same actions.
 *
 * So it carries no lifecycle colour. Filling it green would read as finished
 * and red as cancelled; the outline tone exists for markers that are not
 * states. See `Badge`.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Nothing renders for an ordinary Trip — an absent badge is the statement, and
 * a second label saying "not a losrit" on every row would be noise.
 */
export function LosritBadge({ trip }: { trip: Trip }) {
  const t = useTranslation();

  if (!trip.isLooseTrip) {
    return null;
  }

  return <Badge tone="outline">{t("ritten.losrit.badge")}</Badge>;
}
