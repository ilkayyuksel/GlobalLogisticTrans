import { Badge, TONE_CLASSES } from "@/components/ui/badge";
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
 * So it carries no LIFECYCLE colour: green would read as finished and red as
 * cancelled. It wears `neutral` instead — the quiet grey this system uses for
 * a marker that classifies rather than progresses. Enough to pick out of a
 * long list, and not enough to compete with the status badge beside it.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Nothing renders for an ordinary Trip — an absent badge is the statement, and
 * a second label saying "not a losrit" on every row would be noise.
 */
export function LosritBadge({
  trip,
  onRemove,
}: {
  trip: Trip;
  /**
   * Takes the CLASSIFICATION off — never the Trip.
   *
   * Absent where the badge is only being displayed, which is why the control
   * appears in the list and not on every screen that shows a badge.
   */
  onRemove?: (trip: Trip) => void;
}) {
  const t = useTranslation();

  if (!trip.isLooseTrip) {
    return null;
  }

  if (!onRemove) {
    return <Badge tone="neutral">{t("ritten.losrit.badge")}</Badge>;
  }

  /*
   * A button rather than a badge with an "x" beside it: the whole marker is the
   * control, and its accessible name says what it removes. "Losrit verwijderen"
   * and never plain "Verwijderen" — this takes a label off a Trip that stays
   * exactly as it is, and confusing it with deleting the transport would be the
   * worst possible mistake to invite.
   */
  return (
    <button
      type="button"
      onClick={() => {
        /*
         * The page reports every failure in its own feedback line and rethrows
         * so an inline editor can keep its cell open. A badge has no cell to
         * keep open, so the rejection ends here rather than becoming an
         * unhandled promise.
         */
        void Promise.resolve(onRemove(trip)).catch(() => undefined);
      }}
      title={t("ritten.losrit.remove")}
      aria-label={`${t("ritten.losrit.remove")} ${trip.bookingNumber ?? trip.id}`}
      /* The same tone the badge wears, from the same table. */
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium hover:opacity-80 ${TONE_CLASSES.neutral}`}
    >
      {t("ritten.losrit.badge")}
      <span aria-hidden="true" className="text-muted">
        ×
      </span>
    </button>
  );
}
