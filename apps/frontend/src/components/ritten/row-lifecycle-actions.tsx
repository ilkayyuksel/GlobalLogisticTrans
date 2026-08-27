"use client";

import type { Trip } from "@/lib/api/types";
import type { WhatsAppStatus } from "@/lib/api/whatsapp";
import { SendPdfButton } from "./send-pdf-button";
import { useTranslation } from "@/lib/i18n/language-provider";
import { STATUS_LABEL_KEYS, type RittenActions } from "@/lib/ritten/row-actions";
import { canDelete, primaryRowAction } from "@/lib/trip-actions";

/**
 * What a row can do, as buttons rather than as a menu.
 *
 * ── THE "ACTIES" DROPDOWN IS GONE ───────────────────────────────────────────
 * It hid the one thing an operator does all day — marking a transport finished
 * — behind an open, a read and a click. Everything else it held had already
 * grown a direct control of its own: the PDF column opens and downloads the
 * document, the group badge opens the Combination, the custom-property cell
 * opens its dialog, and the booking number links to the Trip.
 *
 * What is left is the lifecycle, and the lifecycle is deterministic — one
 * action per status, from `primaryRowAction`. So it is simply a button.
 *
 * NOTHING HERE CONFIRMS. Completing is routine, it is visible in the row the
 * moment it succeeds, and a dialog in front of a routine action is one people
 * learn to dismiss without reading — which then dismisses the dialogs that
 * matter. Reopening is the undo of a cancellation and needs no ceremony either.
 * Cancelling, which is the one an operator would regret, is not offered here at
 * all; it keeps its confirmation on the Trip detail page.
 *
 * DELETING IS THE ONE THAT ASKS. It is not routine, it takes a transport out of
 * the planning, and an operator who did it by accident will not see it in the
 * list to put it back — so it opens the application's own confirmation rather
 * than acting, and it is styled as destructive so it is never mistaken for the
 * routine button beside it. It appears where the backend accepts it: an OPEN
 * Trip, and a CANCELLED one — which no longer has to be reopened first, a
 * detour that moved it through a state it was never in.
 *
 * REOPENING A CANCELLATION ASKS TOO. Completing does not: it is routine and the
 * row says so a moment later. Putting a called-off transport back in the
 * planning says it is happening after all, which is worth a sentence.
 *
 * AND NOTHING ELSE BELONGS HERE. No edit button, no "more", no second menu by
 * another name. Editing a Trip's less common fields is the Trip detail page's
 * job, which the booking number in every row links to.
 * ────────────────────────────────────────────────────────────────────────────
 */
export function RowLifecycleActions({
  trip,
  actions,
  isBusy,
  whatsAppStatus,
  onDelete,
  onReopen,
}: {
  trip: Trip;
  actions: RittenActions;
  isBusy: boolean;
  whatsAppStatus: WhatsAppStatus;
  /** Opens the confirmation. The row never deletes anything itself. */
  onDelete: (trip: Trip) => void;
  /**
   * Opens the reopen confirmation. Only CANCELLED reaches it — a cancelled
   * transport was called off, and putting it back says it is happening after
   * all, which is worth a sentence before it takes effect.
   */
  onReopen: (trip: Trip) => void;
}) {
  const t = useTranslation();
  const action = primaryRowAction(trip);

  /*
   * The visible label is short — "Afwerken" — because the column is narrow and
   * the row it sits in says which Trip it belongs to. The ACCESSIBLE name adds
   * the booking number, so a screen reader does not read out a column of
   * identical buttons, and so the bulk toolbar's own "Afwerken" stays a
   * different control from any row's.
   */
  const nameFor = (label: string) =>
    trip.bookingNumber ? `${label} ${trip.bookingNumber}` : label;

  return (
    <span className="flex items-center gap-1">
      {action ? (
        <button
          type="button"
          disabled={isBusy}
          onClick={() => {
            // Reopening a cancellation asks first; completing does not.
            if (action.target === "OPEN") {
              onReopen(trip);

              return;
            }

            /*
             * The page reports every failure in its own feedback line and
             * rethrows so an inline editor can keep its cell open. A button has
             * no cell to keep open, so the rejection ends here rather than
             * becoming an unhandled promise.
             */
            void Promise.resolve(
              actions.changeStatus(trip, action.target),
            ).catch(() => undefined);
          }}
          aria-label={nameFor(t(STATUS_LABEL_KEYS[action.target]))}
          className="whitespace-nowrap rounded-md border border-primary/40 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t(STATUS_LABEL_KEYS[action.target])}
        </button>
      ) : null}

      {canDelete(trip) ? (
        <button
          type="button"
          disabled={isBusy}
          onClick={() => onDelete(trip)}
          aria-label={nameFor(t("ritten.menu.delete"))}
          className="whitespace-nowrap rounded-md border border-danger/40 px-2 py-1 text-xs font-medium text-danger hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t("ritten.menu.delete")}
        </button>
      ) : null}

      {/*
        Last in the strip, after the lifecycle. Sending is not a state change —
        it hands a driver a document — so it sits beside the transitions rather
        than among them, and it never confirms.
      */}
      <SendPdfButton
        trip={trip}
        whatsAppStatus={whatsAppStatus}
        isBusy={isBusy}
        onSend={actions.sendPdf}
      />
    </span>
  );
}
