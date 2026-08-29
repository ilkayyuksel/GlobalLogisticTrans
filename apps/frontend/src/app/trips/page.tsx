"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { CombinationDialog } from "@/components/ritten/combination-dialog";
import { CustomPropertiesDialog } from "@/components/ritten/custom-properties-dialog";
import { DateSection } from "@/components/ritten/date-section";
import { ExportButton } from "@/components/ritten/export-button";
import { GroupConfirmDialog } from "@/components/ritten/group-confirm-dialog";
import {
  ConfirmDialog,
  ConfirmedTrip,
} from "@/components/ritten/confirm-dialog";
import { NewTripDialog } from "@/components/ritten/new-trip-dialog";
import { PdfViewerDialog } from "@/components/ritten/pdf-viewer-dialog";
import { SelectionToolbar } from "@/components/ritten/selection-toolbar";
import { PeriodNav } from "@/components/ritten/period-nav";
import { RittenCounters } from "@/components/ritten/ritten-counters";
import {
  DEFAULT_RITTEN_SORT,
  RittenSortControl,
  type RittenSort,
} from "@/components/ritten/ritten-sort";
import {
  EMPTY_RITTEN_FILTERS,
  RittenFilters,
  type RittenFilterValues,
  hasActiveRittenFilters,
  toFilterParams,
} from "@/components/ritten/ritten-filters";
import { RittenPagination } from "@/components/ritten/ritten-pagination";
import { ViewSwitcher } from "@/components/ritten/view-switcher";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { Spinner } from "@/components/ui/spinner";
import { useAsync } from "@/hooks/use-async";
import { useDebounced } from "@/hooks/use-debounced";
import { userFacingMessage } from "@/lib/api/client";
import { listCustomProperties } from "@/lib/api/custom-properties";
import { listActiveVehicles } from "@/lib/api/fleet";
import { fetchPdfDocument } from "@/lib/api/pdf-documents";
import {
  resetTripPricingOverride,
  saveTripPricingOverride,
  type OverridableComponent,
} from "@/lib/api/trip-pricing-overrides";
import { getRittenCounts } from "@/lib/api/ritten";
import { TooManyTripsError, fetchPeriodTrips } from "@/lib/api/trip-pages";
import {
  fetchWhatsAppStatus,
  sendTripPdfOverWhatsApp,
  type WhatsAppStatus,
} from "@/lib/api/whatsapp";
import { canComplete } from "@/lib/trip-actions";
import {
  changeTripStatus,
  completeTrips,
  createTrip,
  createTripGroup,
  listTripTerminals,
  deleteTrip,
  listTrips,
  markTripsLoose,
  removeTripFromGroup,
  updateTrip,
  MAX_PAGE_SIZE,
  type CreateTripPayload,
  type UpdateTripPayload,
} from "@/lib/api/trips";
import type {
  ChangeableTripStatus,
  CostConfirmation,
  EffectivePricing,
  Trip,
} from "@/lib/api/types";
import { downloadBlob } from "@/lib/download";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { TranslationKey } from "@/lib/i18n/translations";
import { buildSections } from "@/lib/ritten/sections";
import { toCostConfirmationLabel } from "@/lib/trips/cost-confirmation";
import type { RittenActions } from "@/lib/ritten/row-actions";
import {
  periodEnd,
  periodQuery,
  periodStart,
  todayAnchor,
  type RittenView,
} from "@/lib/ritten/period";

/**
 * Ritten — the transport orders, as Dag, Week and Maand LISTS.
 *
 * All three views ask the same question of the backend and differ only in the
 * range of planning dates. There is no hourly grid and no vehicle lane: a
 * transport order is a row, and the day it is planned for is a heading.
 *
 * This page owns every mutation, and each one follows the same three steps:
 * call the backend, refetch the authoritative data, then report what happened.
 * Nothing is applied optimistically and no result is assumed — a Trip that
 * closes but is not priced still shows CLOSED, with the problem stated rather
 * than corrected by reopening it.
 *
 * The view, the period and the filters survive every mutation: an operator who
 * closes a Trip in week 34 stays in week 34.
 */

/**
 * How many rows one page holds, per period.
 *
 * ── WHY THIS IS NOT ONE NUMBER ──────────────────────────────────────────────
 * A day holds a handful of Trips; a month holds every day of them. With one
 * size for all three, a wider STATUS filter made the result larger and pushed
 * rows onto page two — so a Trip an operator had just seen under "Open"
 * vanished under "Alles", which looks exactly like a broken filter and is
 * really the page ending.
 *
 * A month therefore asks for the endpoint's maximum. That is one request either
 * way: the size changes, the number of requests does not.
 * ────────────────────────────────────────────────────────────────────────────
 */
const PAGE_SIZE_BY_VIEW: Record<RittenView, number> = {
  day: 50,
  week: 100,
  month: MAX_PAGE_SIZE,
};

/**
 * A document the viewer was asked to open, and what to call it.
 *
 * `pdfDocumentId` is omitted for the transport order, which the viewer already
 * defaults to. It is supplied for a Cost Confirmation, which is a DIFFERENT
 * document belonging to the same Trip.
 */
interface ViewedDocument {
  readonly trip: Trip;
  readonly pdfDocumentId?: string;
  readonly title?: string;
}

/** The backend's own minimum; below it there is nothing to group. */
const MINIMUM_TRIPS_PER_GROUP = 2;

/** Long enough that typing a booking number is one request, not eight. */
const SEARCH_DEBOUNCE_MS = 300;

interface Feedback {
  readonly messageKey: TranslationKey;
  readonly detail?: string;
  readonly isError: boolean;
  /**
   * Placeholders to fill into the translated sentence, as `{name}`.
   *
   * The first message whose wording depends on data — "PDF verzonden naar Jan
   * Peeters" — and appending the name after a dash would read like an error
   * detail rather than part of the sentence.
   */
  readonly values?: Readonly<Record<string, string>>;
}

/** Fills `{placeholders}` in a translated sentence. */
function fill(text: string, values: Readonly<Record<string, string>> = {}): string {
  return Object.entries(values).reduce(
    (filled, [name, value]) => filled.replace(`{${name}}`, value),
    text,
  );
}

/**
 * One shared empty map, so clearing the row-local corrections changes no
 * identity and costs no render.
 */
const NO_UPDATED_PRICING: ReadonlyMap<string, EffectivePricing> = new Map();

export default function RittenPage() {
  const t = useTranslation();

  const [view, setView] = useState<RittenView>("day");
  const [anchor, setAnchor] = useState<string>(todayAnchor);
  const [filters, setFilters] = useState<RittenFilterValues>(EMPTY_RITTEN_FILTERS);
  const [page, setPage] = useState(1);

  /*
   * ── THE SELECTION IS NOT PER PAGE ─────────────────────────────────────────
   * It used to be cleared on every filter, page or view change, which made the
   * thing it exists for impossible: a Combination that runs over two days —
   * out on Monday, empty back on Tuesday — cannot be selected without changing
   * day between the two ticks.
   *
   * So selected ids live at the page level and survive navigation. They are
   * Trip IDS, never booking numbers: two Trips legitimately share a booking
   * number now, and identity is the pair (booking, container).
   *
   * Nothing is cleared for being off screen. A Trip the operator picked on
   * Monday is still picked on Tuesday, and the toolbar keeps saying so.
   * ──────────────────────────────────────────────────────────────────────────
   */

  const [selectedTripIds, setSelectedTripIds] = useState<Set<string>>(new Set());
  const [isGroupDialogOpen, setIsGroupDialogOpen] = useState(false);
  /** The Trip whose deletion is being confirmed, or null. */
  const [deletingTrip, setDeletingTrip] = useState<Trip | null>(null);
  /** The CANCELLED Trip whose reopening is being confirmed, or null. */
  const [reopeningTrip, setReopeningTrip] = useState<Trip | null>(null);
  /*
   * What the PDF viewer was asked to show.
   *
   * The Trip alone is no longer enough: a Trip has its transport order AND, at
   * most, one Cost Confirmation, which is a different document that arrived
   * later. The document id travels with the request so the viewer opens the one
   * that was clicked rather than defaulting to the order.
   */
  const [viewing, setViewing] = useState<ViewedDocument | null>(null);
  const [openCombinationId, setOpenCombinationId] = useState<string | null>(null);
  const [customPropertiesTrip, setCustomPropertiesTrip] = useState<Trip | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const [busyTripId, setBusyTripId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const [sort, setSort] = useState<RittenSort>(DEFAULT_RITTEN_SORT);
  /*
   * Prices are off until asked for. The Ritten list is read over a driver's
   * shoulder and on a shared screen, so money is not on it by default — and
   * when it is off the columns are absent, not blanked.
   */
  const [showPricing, setShowPricing] = useState(false);

  const debouncedSearch = useDebounced(filters.search, SEARCH_DEBOUNCE_MS);

  const { status, vehicleId, terminal, customPropertyId } = filters;

  // Built from the individual values so a keystroke in an unrelated field
  // cannot retrigger the request through a new object identity.
  const query = useMemo(
    () => ({
      ...periodQuery(view, anchor),
      ...toFilterParams(
        { search: "", status, vehicleId, terminal, customPropertyId },
        debouncedSearch,
      ),
      // The DATABASE orders the rows. Sorting the page in the browser would
      // order only what is on screen and misrepresent the rest of the period.
      sortBy: sort.field,
      sortDirection: sort.direction,
    }),
    [
      view,
      anchor,
      status,
      vehicleId,
      terminal,
      customPropertyId,
      debouncedSearch,
      sort,
    ],
  );

  // A narrowed period usually has fewer pages than the one being viewed, and
  // page 4 of a 1-page result is an empty screen that reads as "no trips".
  useEffect(() => {
    setPage(1);
  }, [query]);

  const pageSizeForView = PAGE_SIZE_BY_VIEW[view];

  /*
   * ── A PERIOD IS LOADED WHOLE; A DAY IS PAGED ──────────────────────────────
   * The Week and Month headings name every day of the period, so the list
   * behind them has to hold every day of it. Loading one page instead was a
   * real bug: a week of 142 Trips came back as page one of two, the sections
   * were built from those 100 rows, and Monday — which sorts LAST, because the
   * backend orders `planningDate` descending — rendered empty underneath a
   * counter that said 142.
   *
   * `fetchPeriodTrips` collects the pages sequentially and returns them as one,
   * so nothing downstream has to know: the sections, the pagination control and
   * the truncation notice all still read a `Paginated<Trip>`. 142 Trips is ONE
   * request at 200 a page; a busy month of 600 is three.
   *
   * The DAY view keeps ordinary pagination. Its screen promises one day and a
   * page control, not a complete period, and it is already explicit about it.
   */
  const trips = useAsync(
    useCallback(
      (signal: AbortSignal) =>
        view === "day"
          ? listTrips({ ...query, page, pageSize: pageSizeForView }, signal)
          : fetchPeriodTrips(query, signal),
      [view, query, page, pageSizeForView],
    ),
    [view, query, page, pageSizeForView],
  );

  const counts = useAsync(
    useCallback(
      (signal: AbortSignal) => getRittenCounts(query, signal),
      [query],
    ),
    [query],
  );

  /**
   * The vehicle picker, fetched once for the whole page.
   *
   * Not per row and not per opened cell: the fleet of a family business is one
   * small list, and every editable row shares it. Drivers are deliberately not
   * fetched — a Trip is planned onto a truck, and its driver follows from that
   * truck's assignment rather than being picked here.
   */
  const vehicles = useAsync(
    useCallback((signal: AbortSignal) => listActiveVehicles(signal), []),
    [],
  );

  /*
   * Whether WhatsApp can deliver anything, fetched ONCE for the whole page
   * rather than per row: it is a property of the service, not of a Trip, and a
   * request per row would be a hundred identical questions.
   *
   * A page that cannot reach the status endpoint treats WhatsApp as
   * unavailable. That is the safe direction — the button explains itself and
   * the backend refuses anyway — where assuming CONNECTED would offer a send
   * that can only fail.
   */
  const whatsApp = useAsync(
    useCallback(() => fetchWhatsAppStatus(), []),
    [],
  );
  const whatsAppStatus: WhatsAppStatus = whatsApp.data
    ? whatsApp.data.status
    : "ERROR";

  /**
   * What the terminal and Custom-waarde filters can offer.
   *
   * Both are fetched once, alongside the vehicles, and for the same reason.
   * They come from different places on purpose: Custom Properties are
   * configuration and have their own endpoint, while terminals are not
   * configured anywhere — the string a transport order printed IS the terminal,
   * so the only honest list is the distinct values the Trips carry.
   */
  const filterOptions = useAsync(
    useCallback(
      (signal: AbortSignal) =>
        Promise.all([
          listTripTerminals(signal),
          listCustomProperties({ isActive: true, pageSize: MAX_PAGE_SIZE }, signal),
        ]),
      [],
    ),
    [],
  );

  /**
   * Corrections made since this page of Trips was loaded, keyed by Trip id.
   *
   * ── WHY THERE IS NO PRICING REQUEST HERE ──────────────────────────────────
   * The pricing of every row TRAVELS ON THE TRIP: the list endpoint resolves
   * the whole page in one batched read. So showing prices costs no request at
   * all, a week of 300 Trips costs exactly the two list requests it already
   * cost, and there is no second read that could fail on its own or arrive out
   * of step with the rows it describes.
   *
   * This map holds only what the override endpoints answered after an operator
   * corrected an amount. Each of those answers is the complete recalculated
   * breakdown for ONE Trip, which is what lets that row update without
   * refetching the list — and why Brandstof and Totaal are right afterwards
   * without anything on this side computing either.
   */
  const [updatedPricingByTripId, setUpdatedPricingByTripId] = useState(
    NO_UPDATED_PRICING,
  );

  /*
   * A freshly loaded list is authoritative, so the row-local answers are
   * dropped when one arrives. Keeping them would let a correction made before a
   * refetch shadow the newer figures that same refetch just delivered.
   */
  useEffect(() => {
    setUpdatedPricingByTripId(NO_UPDATED_PRICING);
  }, [trips.data]);

  /**
   * Applies one recalculated breakdown to one row.
   *
   * A null answer means the Trip has never been priced — the correction is
   * stored and will apply once the Engine prices it, but there is nothing to
   * show yet, so the row is left as it is rather than being blanked.
   */
  const applyPricing = useCallback(
    (tripId: string, pricing: EffectivePricing | null): void => {
      if (!pricing) {
        return;
      }

      setUpdatedPricingByTripId((current) =>
        new Map(current).set(tripId, pricing),
      );
    },
    [],
  );

  const sections = useMemo(
    () => buildSections(view, anchor, trips.data?.items ?? []),
    [view, anchor, trips.data],
  );

  const isFiltered = hasActiveRittenFilters(filters);
  /*
   * Only the DAY view can now show a partial result, and it says so through its
   * page control rather than through this notice. A period that loaded is
   * complete by construction — `fetchPeriodTrips` returns everything or throws
   * — so `totalPages > 1` can no longer happen there.
   */
  const isTruncated = (trips.data?.meta.totalPages ?? 1) > 1;
  /*
   * The one case where a period genuinely cannot be shown: more Trips than the
   * bounded fetch may collect. It is an ERROR rather than a quiet partial list,
   * because a partial list that looks complete is what this whole change exists
   * to remove.
   */
  const isPeriodTooLarge = trips.error instanceof TooManyTripsError;
  // The table stays on screen during a refetch: collapsing it after every save
  // would throw the operator out of the row they were working in.
  const isFirstLoad = trips.isLoading && !trips.data;

  function showDay(date: string): void {
    setView("day");
    setAnchor(date);
  }

  /**
   * One backend call, then the authoritative data, then the report.
   *
   * Both the list and the counters are refetched, because a status change moves
   * a Trip between them. The period and the filters are untouched, so the
   * operator stays exactly where they were.
   */
  async function runMutation(
    trip: Trip,
    operation: () => Promise<unknown>,
    successKey: TranslationKey,
  ): Promise<void> {
    setBusyTripId(trip.id);
    setFeedback(null);

    try {
      await operation();

      trips.reload();
      counts.reload();
      /*
       * The new prices arrive with the refetched list. A mutation can change
       * what a Trip costs — waiting time above all — and the amounts travel on
       * the Trip, so `trips.reload()` above has already asked for them. This
       * side never calculates a price; the only way for it to show a new one is
       * to be told, and it just was.
       */
      setFeedback({ messageKey: successKey, isError: false });
    } catch (error: unknown) {
      setFeedback({
        messageKey: "ritten.feedback.failed",
        detail: userFacingMessage(error),
        isError: true,
      });

      // Rethrown so an inline cell can keep its editor open and show the
      // field-level detail the backend returned.
      throw error;
    } finally {
      setBusyTripId(null);
    }
  }

  /*
   * ── WHY NOTHING IS CHECKED AFTER CLOSING ──────────────────────────────────
   * Completing used to read the Trip's pricing straight afterwards and mark the
   * row when there was none. It read as a failure of the completion, which it
   * never was: a Trip whose route is not configured is legitimately finished
   * work, and the operator had done nothing wrong.
   *
   * The absence of a price is still visible where prices are — the pricing
   * cells stay empty, and Opnieuw verwerken stays available — but it is a
   * configuration fact to look at, not an error to report at the moment
   * somebody ticks a Trip off.
   * ──────────────────────────────────────────────────────────────────────────
   */

  const visibleTrips = trips.data?.items ?? [];

  /**
   * THE selection: every Trip id the operator has ticked, wherever it was.
   *
   * This is what the actions send. Filtering it down to the current page would
   * quietly drop Monday's Trip when the operator moved to Tuesday to tick the
   * second half of a Combination — which is the whole reason a cross-day
   * selection exists.
   */
  const selectedIds = [...selectedTripIds];

  /*
   * The ones that happen to be on screen. Used only to SHOW something about
   * them — the confirmation lists their bookings and dates — never to decide
   * what is sent.
   */
  const selectedVisibleTrips = visibleTrips.filter((trip) =>
    selectedTripIds.has(trip.id),
  );

  /*
   * Whether completing has anything to do.
   *
   * Only decidable for the Trips on screen: the status of one selected two days
   * ago is not loaded, and fetching it to grey out a button would be a request
   * per selected row. So the guard applies when the WHOLE selection is visible,
   * and otherwise the backend decides — which it does anyway, atomically.
   */
  const isSelectionFullyVisible =
    selectedVisibleTrips.length === selectedTripIds.size;
  const canCompleteSelection =
    selectedTripIds.size > 0 &&
    (!isSelectionFullyVisible || selectedVisibleTrips.some(canComplete));

  function toggleSelection(tripId: string): void {
    setSelectedTripIds((current) => {
      const next = new Set(current);

      if (next.has(tripId)) {
        next.delete(tripId);
      } else {
        next.add(tripId);
      }

      return next;
    });
  }

  /**
   * Groups the selected Trips.
   *
   * The list is refetched before anything appears: the group id comes from the
   * backend, never from here, so the marker in the table is the real one.
   */
  async function groupSelected(): Promise<void> {
    // Every selected id, including Trips on days that are not on screen:
    // grouping across days is exactly what this is for.
    await createTripGroup(selectedIds);

    trips.reload();
    counts.reload();
    setSelectedTripIds(new Set());
    setFeedback({ messageKey: "ritten.group.created", isError: false });
  }

  /**
   * Marks every selected Trip that can be closed as CLOSED.
   *
   * ONE request for the whole selection. The backend applies the same rule to
   * each and refuses the lot if any Trip cannot be closed, so nothing here
   * loops or decides — it sends the ids and reports what came back.
   *
   * No confirmation is asked for. Completing is routine, it is visible in the
   * rows a moment later, and a dialog in front of a routine action is one
   * people learn to dismiss without reading.
   */
  /**
   * Classifies the whole selection as LOSRIT.
   *
   * ── NOT A LIFECYCLE ACTION ────────────────────────────────────────────────
   * One column changes. Nothing is confirmed, nothing is priced, no document is
   * touched, and no status moves — the badge appearing on the rows after the
   * refetch is the entire feedback, which is what makes it safe to do without a
   * dialog in front of it.
   *
   * The FULL selection is sent, days and pages included, exactly as grouping
   * and completion send it. The backend decides whether the selection may be
   * classified — a Trip in a Combination may not — and refuses all of it or
   * none, so a partial application is not a state this can reach.
   */
  async function markSelectedLoose(): Promise<void> {
    setFeedback(null);

    try {
      await markTripsLoose(selectedIds);

      trips.reload();
      counts.reload();
      setSelectedTripIds(new Set());
      setFeedback({ messageKey: "ritten.feedback.markedLoose", isError: false });
    } catch (error: unknown) {
      // The backend's own words — it names the Trip and the group that stopped
      // the request, which is what makes the refusal actionable.
      setFeedback({
        messageKey: "ritten.feedback.failed",
        detail: userFacingMessage(error),
        isError: true,
      });
    }
  }

  async function completeSelected(): Promise<void> {
    setFeedback(null);

    try {
      await completeTrips(selectedIds);

      trips.reload();
      counts.reload();
      setSelectedTripIds(new Set());
      setFeedback({
        messageKey: "ritten.feedback.completed",
        isError: false,
      });
    } catch (error: unknown) {
      setFeedback({
        messageKey: "ritten.feedback.completeFailed",
        detail: userFacingMessage(error),
        isError: true,
      });
    }
  }

  /**
   * Soft-deletes one Trip, after the confirmation dialog said so.
   *
   * The Trip leaves the planning and its row, documents, history and any Cost
   * Confirmation stay exactly where they are — the backend sets a status and
   * writes nothing else. Only THIS Trip: by id, never by booking number, which
   * several Trips legitimately share.
   *
   * Its id also leaves the selection, and only its id. A Trip that is no longer
   * in the list cannot be acted on, but the other days the operator ticked are
   * still theirs.
   */
  async function deleteOneTrip(trip: Trip): Promise<void> {
    await deleteTrip(trip.id);

    setSelectedTripIds((current) => {
      const remaining = new Set(current);
      remaining.delete(trip.id);

      return remaining;
    });

    trips.reload();
    counts.reload();
    setFeedback({ messageKey: "ritten.feedback.deleted", isError: false });
  }

  const actions: RittenActions = {
    saveTrip: async (tripId, payload: UpdateTripPayload) => {
      const trip = trips.data?.items.find((item) => item.id === tripId);

      await runMutation(
        trip ?? ({ id: tripId } as Trip),
        () => updateTrip(tripId, payload),
        "ritten.feedback.saved",
      );
    },
    changeStatus: async (trip, status: ChangeableTripStatus) => {
      await runMutation(
        trip,
        () => changeTripStatus(trip.id, status),
        "ritten.feedback.statusChanged",
      );

    },
    unlinkFromGroup: (trip) =>
      runMutation(
        trip,
        () => removeTripFromGroup(trip.id),
        "ritten.group.unlinked",
      ),
    openPdf: (trip) => setViewing({ trip }),
    /*
     * The confirmation's own document, resolved from the CostConfirmation the
     * list response already carried — no request per row to find it, and never
     * the Trip's `pdfDocumentId`, which is the transport order.
     *
     * Only reachable for a Trip that has one: the button is not rendered
     * otherwise, which is why the id can be asserted here.
     */
    openCostConfirmationPdf: (trip) => {
      const confirmation = trip.costConfirmation as CostConfirmation;

      setViewing({
        trip,
        pdfDocumentId: confirmation.pdfDocumentId,
        title: toCostConfirmationLabel(confirmation),
      });
    },
    /**
     * Downloading fetches the same resource the viewer shows. No second copy
     * is kept anywhere, and the file is never re-uploaded or re-parsed.
     */
    downloadPdf: async (trip) => {
      setFeedback(null);

      try {
        // Both are guarded by `canViewPdf`, which is what enables the action:
        // a Trip with no document cannot reach here. The filename falls back to
        // the Trip's id when it has no booking number.
        downloadBlob(
          await fetchPdfDocument(trip.pdfDocumentId as string),
          `${trip.bookingNumber ?? trip.id}.pdf`,
        );
      } catch (error: unknown) {
        setFeedback({
          messageKey: "ritten.pdf.failed",
          detail: userFacingMessage(error),
          isError: true,
        });
      }
    },
    deleteTrip: deleteOneTrip,
    /*
     * The LABEL comes off; the Trip stays. One field, through the ordinary
     * update endpoint — no status change, no planning change, no identity
     * change, no pricing and no document touched.
     */
    /*
     * Sending is an OUTWARD action: it reads a Trip and hands a document to
     * WhatsApp. Nothing is written, so this deliberately does not go through
     * `runMutation` — no reload of the list, no reload of the pricing, and no
     * chance that a failed send is mistaken for a failed change.
     */
    sendPdf: async (trip) => {
      setFeedback(null);

      try {
        const { driverName } = await sendTripPdfOverWhatsApp(trip.id);

        setFeedback({
          messageKey: "ritten.whatsapp.sent",
          values: { driver: driverName },
          isError: false,
        });
      } catch (error: unknown) {
        // The backend's own sentence — "WhatsApp is niet verbonden", "Jan
        // Peeters heeft geen telefoonnummer" — never a status code or a stack.
        setFeedback({
          messageKey: "ritten.whatsapp.failed",
          detail: userFacingMessage(error),
          isError: true,
        });

        throw error;
      }
    },
    /**
     * A manual price correction on ONE Trip.
     *
     * ── WHY THIS IS NOT `runMutation` ─────────────────────────────────────
     * Every other write here refetches the list, because the backend's answer
     * describes only the row that changed and the rest of the page may have
     * moved with it. A pricing correction is different in both halves: it
     * changes exactly one Trip and nothing else, and the endpoint answers with
     * that Trip's COMPLETE recalculated breakdown. So the row is updated from
     * the response, the list is left alone, and the selection, the filters and
     * the operator's scroll position all survive.
     *
     * The error is rethrown rather than reported here: the cell is still open
     * with the attempted amount in it, and the backend's own wording belongs
     * beside the field it is about. Nothing was painted, so nothing has to be
     * put back — the row still shows the persisted amount.
     */
    savePricingOverride: async (
      tripId: string,
      componentCode: OverridableComponent,
      amount: number,
    ) => {
      applyPricing(
        tripId,
        await saveTripPricingOverride(tripId, componentCode, amount),
      );
    },
    resetPricingOverride: async (
      tripId: string,
      componentCode: OverridableComponent,
    ) => {
      applyPricing(
        tripId,
        await resetTripPricingOverride(tripId, componentCode),
      );
    },
    removeLosrit: (trip) =>
      runMutation(
        trip,
        () => updateTrip(trip.id, { isLooseTrip: false }),
        "ritten.feedback.losritRemoved",
      ),
    openCombination: setOpenCombinationId,
    openCustomProperties: setCustomPropertiesTrip,
  };

  return (
    <div className="mx-auto max-w-[1600px] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">
          {t("ritten.title")}
        </h1>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setIsCreating(true)}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover"
          >
            {t("ritten.new.open")}
          </button>

          <ExportButton
            query={query}
            periodStart={periodStart(view, anchor)}
            periodEnd={periodEnd(view, anchor)}
          />
        </div>
      </div>

      <RittenCounters
        counts={counts.data ?? null}
        isLoading={counts.isLoading}
        status={filters.status}
        onStatusChange={(next) => setFilters({ ...filters, status: next })}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ViewSwitcher view={view} onChange={setView} />
        <PeriodNav view={view} anchor={anchor} onChange={setAnchor} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <RittenSortControl value={sort} onChange={setSort} />

        <label className="flex items-center gap-2 text-sm text-secondary">
          <input
            type="checkbox"
            checked={showPricing}
            onChange={(event) => setShowPricing(event.target.checked)}
            className="h-4 w-4 rounded border-border accent-primary"
          />
          {t("ritten.pricing.show")}
        </label>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <RittenFilters
          values={filters}
          vehicles={vehicles.data ? vehicles.data.items : []}
          terminals={filterOptions.data ? filterOptions.data[0] : []}
          customProperties={
            filterOptions.data ? filterOptions.data[1].items : []
          }
          onChange={setFilters}
          onReset={() => setFilters(EMPTY_RITTEN_FILTERS)}
        />
      </div>

      {selectedTripIds.size > 0 ? (
        <SelectionToolbar
          selectedCount={selectedTripIds.size}
          // Against the ROWS ON SCREEN, not against the total selected: with
          // Monday's Trip selected and Tuesday's showing, the two counts match
          // by coincidence while there is still a row left to add.
          canSelectAllVisible={visibleTrips.some(
            (trip) => !selectedTripIds.has(trip.id),
          )}
          canGroup={selectedIds.length >= MINIMUM_TRIPS_PER_GROUP}
          canComplete={canCompleteSelection}
          isBusy={busyTripId !== null}
          onSelectAllVisible={() =>
            // Added to what is already selected, never replacing it: five
            // picked on Monday plus three on Tuesday is eight.
            setSelectedTripIds(
              (current) =>
                new Set([...current, ...visibleTrips.map((trip) => trip.id)]),
            )
          }
          onClear={() => setSelectedTripIds(new Set())}
          onGroup={() => setIsGroupDialogOpen(true)}
          onMarkLoose={() => void markSelectedLoose()}
          onComplete={() => void completeSelected()}
        />
      ) : null}

      {feedback ? (
        <p
          role="status"
          className={[
            "flex items-center justify-between gap-3 rounded-md border px-4 py-2 text-sm",
            feedback.isError
              ? "border-danger/30 bg-danger/5 text-foreground"
              : "border-success/30 bg-success/5 text-foreground",
          ].join(" ")}
        >
          <span>
            <span className="font-medium">
              {fill(t(feedback.messageKey), feedback.values)}
            </span>
            {feedback.detail ? ` — ${feedback.detail}` : ""}
          </span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="shrink-0 text-xs font-medium text-secondary hover:text-foreground"
          >
            {t("ritten.feedback.dismiss")}
          </button>
        </p>
      ) : null}

      {isFirstLoad ? <LoadingState label={t("ritten.loading")} /> : null}

      {/*
        A period too large to load is not a failure to explain away: it is shown
        as its own state, saying what to do about it, and NEVER as a partial
        list that reads like a complete one.
      */}
      {!isFirstLoad && isPeriodTooLarge ? (
        <p
          role="status"
          className="rounded-md border border-warning/30 bg-warning/5 px-4 py-2 text-sm text-foreground"
        >
          {t("ritten.truncation.notice")}
        </p>
      ) : null}

      {!isFirstLoad && trips.error && !isPeriodTooLarge ? (
        <ErrorState error={trips.error} onRetry={trips.reload} />
      ) : null}

      {!isFirstLoad && !trips.error && trips.data ? (
        <>
          {/*
            Stated before the sections, not after: a week shown one page at a
            time must never read as the whole week.
          */}
          {isTruncated ? (
            <p
              role="status"
              className="rounded-md border border-warning/30 bg-warning/5 px-4 py-2 text-sm text-foreground"
            >
              {t("ritten.truncation.notice")}
            </p>
          ) : null}

          {trips.isLoading ? (
            <p className="flex items-center gap-2 text-sm text-secondary">
              <Spinner label={t("ritten.loading")} />
              {t("ritten.loading")}
            </p>
          ) : null}

          {trips.data.items.length === 0 && view === "month" ? (
            <EmptyState
              title={
                isFiltered ? t("ritten.empty.filtered") : t("ritten.empty.title")
              }
              description={
                isFiltered
                  ? t("ritten.empty.filteredDescription")
                  : t("ritten.empty.description")
              }
            />
          ) : (
            <div className="space-y-4">
              {sections.map((section) => (
                <DateSection
                  key={section.date ?? "unscheduled"}
                  view={view}
                  date={section.date}
                  trips={section.trips}
                  onOpenDay={showDay}
                  actions={actions}
                  vehicles={vehicles.data ? vehicles.data.items : []}
                  busyTripId={busyTripId}
                  selectedTripIds={selectedTripIds}
                  onToggleSelection={toggleSelection}
                  showPricing={showPricing}
                  updatedPricingByTripId={updatedPricingByTripId}
                  whatsAppStatus={whatsAppStatus}
                  onDeleteTrip={setDeletingTrip}
                  onReopenTrip={setReopeningTrip}
                />
              ))}
            </div>
          )}

          {/*
            The DAY view pages. A period is loaded whole, so a control offering
            page 2 of 1 would be furniture that means nothing.
          */}
          {view === "day" ? (
            <RittenPagination meta={trips.data.meta} onChange={setPage} />
          ) : null}
        </>
      ) : null}

      {isGroupDialogOpen ? (
        <GroupConfirmDialog
          // THE SELECTION, by id. The dialog fetches the Trips itself, so one
          // chosen on a day that is not on screen is shown rather than counted.
          tripIds={selectedIds}
          onConfirm={groupSelected}
          onClose={() => setIsGroupDialogOpen(false)}
        />
      ) : null}

      {viewing ? (
        <PdfViewerDialog
          trip={viewing.trip}
          pdfDocumentId={viewing.pdfDocumentId}
          title={viewing.title}
          onClose={() => setViewing(null)}
        />
      ) : null}

      {deletingTrip ? (
        <ConfirmDialog
          titleKey="ritten.delete.title"
          descriptionKey="ritten.delete.description"
          consequenceKey="ritten.delete.consequence"
          confirmKey="ritten.delete.confirm"
          tone="danger"
          onConfirm={() => deleteOneTrip(deletingTrip)}
          onClose={() => setDeletingTrip(null)}
        >
          <ConfirmedTrip trip={deletingTrip} />
        </ConfirmDialog>
      ) : null}

      {/*
        Reopening a cancellation says a called-off transport is happening after
        all. Not destructive, so the primary tone — but still asked, unlike
        completing, which is routine.
      */}
      {reopeningTrip ? (
        <ConfirmDialog
          titleKey="ritten.reopen.title"
          descriptionKey="ritten.reopen.description"
          confirmKey="ritten.menu.reopen"
          onConfirm={() => actions.changeStatus(reopeningTrip, "OPEN")}
          onClose={() => setReopeningTrip(null)}
        >
          <ConfirmedTrip trip={reopeningTrip} />
        </ConfirmDialog>
      ) : null}

      {openCombinationId ? (
        <CombinationDialog
          tripGroupId={openCombinationId}
          onUnlink={actions.unlinkFromGroup}
          onClose={() => setOpenCombinationId(null)}
        />
      ) : null}

      {isCreating ? (
        <NewTripDialog
          vehicles={vehicles.data ? vehicles.data.items : []}
          onCreate={async (payload: CreateTripPayload) => {
            await createTrip(payload);
            /*
             * Refetched rather than prepended locally: the new row must be the
             * one the backend stored, in the position the backend's ordering
             * puts it — which for a Trip with no date is the unscheduled
             * section at the bottom.
             */
            await trips.reload();
            await counts.reload();
            setFeedback({ messageKey: "ritten.new.created", isError: false });
          }}
          onClose={() => setIsCreating(false)}
        />
      ) : null}

      {customPropertiesTrip ? (
        <CustomPropertiesDialog
          trip={customPropertiesTrip}
          onChanged={trips.reload}
          onClose={() => setCustomPropertiesTrip(null)}
        />
      ) : null}
    </div>
  );
}
