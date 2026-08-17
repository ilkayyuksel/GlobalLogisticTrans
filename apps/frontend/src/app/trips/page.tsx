"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { CombinationDialog } from "@/components/ritten/combination-dialog";
import { CustomPropertiesDialog } from "@/components/ritten/custom-properties-dialog";
import { DateSection } from "@/components/ritten/date-section";
import { ExportButton } from "@/components/ritten/export-button";
import { GroupConfirmDialog } from "@/components/ritten/group-confirm-dialog";
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
import { TripDetailsDialog } from "@/components/ritten/trip-details-dialog";
import { ViewSwitcher } from "@/components/ritten/view-switcher";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { Spinner } from "@/components/ui/spinner";
import { useAsync } from "@/hooks/use-async";
import { useDebounced } from "@/hooks/use-debounced";
import { userFacingMessage } from "@/lib/api/client";
import { listCustomProperties } from "@/lib/api/custom-properties";
import { listActiveVehicles } from "@/lib/api/fleet";
import { fetchPdfDocument } from "@/lib/api/pdf-documents";
import { getTripPricing, reprocessTripPricing } from "@/lib/api/pricing";
import { getRittenCounts } from "@/lib/api/ritten";
import {
  changeTripStatus,
  createTrip,
  createTripGroup,
  deleteTrip,
  listTripTerminals,
  listTrips,
  removeTripFromGroup,
  restoreTrip,
  updateTrip,
  MAX_PAGE_SIZE,
  type CreateTripPayload,
  type UpdateTripPayload,
} from "@/lib/api/trips";
import type { ChangeableTripStatus, Trip } from "@/lib/api/types";
import { downloadBlob } from "@/lib/download";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { TranslationKey } from "@/lib/i18n/translations";
import { buildSections } from "@/lib/ritten/sections";
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

/** A day fits comfortably; a busy month pages, and says so. */
const PAGE_SIZE = 50;

/** The backend's own minimum; below it there is nothing to group. */
const MINIMUM_TRIPS_PER_GROUP = 2;

/** Long enough that typing a booking number is one request, not eight. */
const SEARCH_DEBOUNCE_MS = 300;

interface Feedback {
  readonly messageKey: TranslationKey;
  readonly detail?: string;
  readonly isError: boolean;
}

export default function RittenPage() {
  const t = useTranslation();

  const [view, setView] = useState<RittenView>("day");
  const [anchor, setAnchor] = useState<string>(todayAnchor);
  const [filters, setFilters] = useState<RittenFilterValues>(EMPTY_RITTEN_FILTERS);
  const [page, setPage] = useState(1);

  const [selectedTripIds, setSelectedTripIds] = useState<Set<string>>(new Set());
  const [isGroupDialogOpen, setIsGroupDialogOpen] = useState(false);
  const [pdfTrip, setPdfTrip] = useState<Trip | null>(null);
  const [openCombinationId, setOpenCombinationId] = useState<string | null>(null);
  const [customPropertiesTrip, setCustomPropertiesTrip] = useState<Trip | null>(null);
  const [detailsTrip, setDetailsTrip] = useState<Trip | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const [busyTripId, setBusyTripId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  /** CLOSED Trips found to have no pricing snapshot after closing. */
  const [pricingAttention, setPricingAttention] = useState<Set<string>>(new Set());

  const [sort, setSort] = useState<RittenSort>(DEFAULT_RITTEN_SORT);

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

  /*
   * Selection is per page, and it says so.
   *
   * Ticking rows and then changing the filter would otherwise leave a selection
   * the operator can no longer see — and then grouping it would act on Trips
   * that are not on screen. Clearing is the only honest behaviour.
   */
  useEffect(() => {
    setSelectedTripIds(new Set());
  }, [query, page, view]);

  const trips = useAsync(
    useCallback(
      (signal: AbortSignal) =>
        listTrips({ ...query, page, pageSize: PAGE_SIZE }, signal),
      [query, page],
    ),
    [query, page],
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

  const sections = useMemo(
    () => buildSections(view, anchor, trips.data?.items ?? []),
    [view, anchor, trips.data],
  );

  const isFiltered = hasActiveRittenFilters(filters);
  const isTruncated = (trips.data?.meta.totalPages ?? 1) > 1;
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

  /**
   * Closing may or may not produce a price.
   *
   * Pricing runs automatically when a Trip closes, but it can fail — a route
   * that is not configured, for instance. The Trip is CLOSED either way and is
   * never reopened to hide that; instead the row says so and Reprocess stays
   * available. This is the only place a Trip's pricing is read, so the list
   * itself never makes a request per row.
   */
  async function noteMissingPricing(trip: Trip): Promise<void> {
    try {
      const pricing = await getTripPricing(trip.id);

      setPricingAttention((current) => {
        const next = new Set(current);

        if (pricing) {
          next.delete(trip.id);
        } else {
          next.add(trip.id);
        }

        return next;
      });
    } catch {
      // A failed check must not turn a successful close into an error.
    }
  }

  const visibleTrips = trips.data?.items ?? [];
  const selectedTrips = visibleTrips.filter((trip) =>
    selectedTripIds.has(trip.id),
  );

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
    await createTripGroup(selectedTrips.map((trip) => trip.id));

    trips.reload();
    counts.reload();
    setSelectedTripIds(new Set());
    setFeedback({ messageKey: "ritten.group.created", isError: false });
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

      if (status === "CLOSED") {
        await noteMissingPricing(trip);
      }
    },
    deleteTrip: (trip) =>
      runMutation(trip, () => deleteTrip(trip.id), "ritten.feedback.deleted"),
    restoreTrip: (trip) =>
      runMutation(trip, () => restoreTrip(trip.id), "ritten.feedback.restored"),
    reprocessPricing: async (trip) => {
      await runMutation(
        trip,
        () => reprocessTripPricing(trip.id),
        "ritten.feedback.reprocessed",
      );

      setPricingAttention((current) => {
        const next = new Set(current);
        next.delete(trip.id);
        return next;
      });
    },
    unlinkFromGroup: (trip) =>
      runMutation(
        trip,
        () => removeTripFromGroup(trip.id),
        "ritten.group.unlinked",
      ),
    openPdf: setPdfTrip,
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
    openCombination: setOpenCombinationId,
    openCustomProperties: setCustomPropertiesTrip,
    openDetails: setDetailsTrip,
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
          visibleCount={visibleTrips.length}
          canGroup={selectedTrips.length >= MINIMUM_TRIPS_PER_GROUP}
          onSelectAllVisible={() =>
            setSelectedTripIds(new Set(visibleTrips.map((trip) => trip.id)))
          }
          onClear={() => setSelectedTripIds(new Set())}
          onGroup={() => setIsGroupDialogOpen(true)}
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
            <span className="font-medium">{t(feedback.messageKey)}</span>
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

      {!isFirstLoad && trips.error ? (
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
                  pricingAttentionTripIds={pricingAttention}
                  selectedTripIds={selectedTripIds}
                  onToggleSelection={toggleSelection}
                />
              ))}
            </div>
          )}

          <RittenPagination meta={trips.data.meta} onChange={setPage} />
        </>
      ) : null}

      {isGroupDialogOpen ? (
        <GroupConfirmDialog
          trips={selectedTrips}
          onConfirm={groupSelected}
          onClose={() => setIsGroupDialogOpen(false)}
        />
      ) : null}

      {pdfTrip ? (
        <PdfViewerDialog trip={pdfTrip} onClose={() => setPdfTrip(null)} />
      ) : null}

      {openCombinationId ? (
        <CombinationDialog
          tripGroupId={openCombinationId}
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

      {detailsTrip ? (
        <TripDetailsDialog
          trip={detailsTrip}
          onSave={actions.saveTrip}
          onClose={() => setDetailsTrip(null)}
        />
      ) : null}
    </div>
  );
}
