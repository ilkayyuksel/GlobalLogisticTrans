"use client";

import { useState } from "react";

import { BulkRouteImportDialog } from "@/components/pricing/bulk-route-import-dialog";
import { CombinationLegSyncDialog } from "@/components/pricing/combination-leg-sync-dialog";
import {
  BLANK_COMBINATION_DRAFT,
  CombinationDeleteDialog,
  CombinationRouteForm,
  CombinationRows,
  type CombinationDraft,
} from "@/components/pricing/combination-routes";
import { RouteForm } from "@/components/pricing/route-form";
import {
  matchesFilter,
  RouteReviewProgress,
  type ReviewFilter,
} from "@/components/pricing/route-review-progress";
import { RouteRow } from "@/components/pricing/route-row";
import { RouteTableHead } from "@/components/pricing/route-table-head";
import {
  BulkDeleteDialog,
  RouteSelectionToolbar,
} from "@/components/pricing/route-selection-toolbar";
import { useRouteSelection } from "@/components/pricing/use-route-selection";
import { ConfirmDialog } from "@/components/ritten/confirm-dialog";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import type { useAsync } from "@/hooks/use-async";
import {
  bulkDeleteRouteConfigurations,
  createCombinationRouteConfiguration,
  createRouteConfiguration,
  deleteCombinationRouteConfiguration,
  deleteRouteConfiguration,
  listCombinationRouteConfigurations,
  listRouteConfigurations,
  markCombinationRouteConfigurationReviewed,
  markRouteConfigurationReviewed,
  previewCombinationLegSync,
  syncCombinationLeg,
  updateCombinationRouteConfiguration,
  updateRouteConfiguration,
  type CombinationLegPosition,
  type CombinationLegSync,
  type CombinationRouteConfiguration,
  type RouteConfiguration,
} from "@/lib/api/route-configuration";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { TranslationKey } from "@/lib/i18n/translations";
import { downloadBlob } from "@/lib/download";
import {
  BLANK_ROUTE_DRAFT,
  toRoutePayload,
  toRouteValues,
  toUpdatedRoutePayload,
  type RouteDraft,
  type RouteField,
} from "@/lib/pricing/route-draft";
import {
  NO_OVERLAY,
  overlayFor,
  withSaved,
  type SavedOverlay,
} from "@/lib/pricing/saved-overlay";
import {
  routeConfigurationFileName,
  toRouteConfigurationBlob,
  toRouteConfigurationDocument,
} from "@/lib/pricing/route-export";

type RoutesState = ReturnType<
  typeof useAsync<Awaited<ReturnType<typeof listRouteConfigurations>>>
>;
type CombinationsState = ReturnType<
  typeof useAsync<
    Awaited<ReturnType<typeof listCombinationRouteConfigurations>>
  >
>;

/** The two kinds of route an operator can configure. */
const ROUTE_TYPES = ["NORMAL", "COMBINATION"] as const;

type RouteType = (typeof ROUTE_TYPES)[number];

/** The selection tick, Van, Naar, Tarief, KM, Tunnel, the review tick, Acties. */
const ROUTE_COLUMN_COUNT = 8;

const TYPE_LABELS: Record<RouteType, TranslationKey> = {
  NORMAL: "settings.pricing.routes.type.normal",
  COMBINATION: "settings.pricing.routes.type.combination",
};

/**
 * Routeprijzen — what each route costs.
 *
 * ── TWO KINDS, SHOWN AS TWO KINDS ───────────────────────────────────────────
 * An ordinary route is one row with its Tarief, KM and Tunnel. A Combination is
 * ONE record with two legs, each with its own Tarief, KM and Tunnel, because a
 * Combination's outbound and return are their own transports and cost different
 * amounts. The list says plainly which is which, and a Combination's two legs
 * are shown together under the group that owns them.
 *
 * The same road may appear in both. That is not a duplicate: the backend reads
 * them in different pricing contexts and neither overwrites the other.
 *
 * ── NOT A TRIP GROUP ────────────────────────────────────────────────────────
 * A Combination here is route CONFIGURATION. It has nothing to do with grouping
 * Trips in the Rittenlijst, which is what decides the Backload.
 *
 * ── AND NOTHING HERE CALCULATES ─────────────────────────────────────────────
 * No amount is derived, summed or converted in the browser. The Toll is the
 * Engine's business: this screen stores kilometres and shows what it stored.
 */
export function RoutePricesSection({
  routes,
  combinations,
  onSaved,
  onReported,
  onFailed,
}: {
  routes: RoutesState;
  combinations: CombinationsState;
  /** Something changed the SET of records: the lists are refetched. */
  onSaved: (messageKey?: TranslationKey) => void;
  /**
   * One record changed in place and the backend already said what it now is.
   *
   * Reported without a refetch: an inline edit changes one route, and asking the
   * server to repeat what it has just answered would be a round trip for nothing.
   */
  onReported: (messageKey?: TranslationKey) => void;
  onFailed: (error: unknown, messageKey?: TranslationKey) => void;
}) {
  const t = useTranslation();
  const [type, setType] = useState<RouteType>("NORMAL");
  const [draft, setDraft] = useState<RouteDraft | null>(null);
  const [combinationDraft, setCombinationDraft] =
    useState<CombinationDraft | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** The record a deletion is being confirmed for. */
  const [deleting, setDeleting] = useState<RouteConfiguration | null>(null);
  const [deletingCombination, setDeletingCombination] =
    useState<CombinationRouteConfiguration | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isDeletingSelection, setIsDeletingSelection] = useState(false);
  /** The backend's preview of a leg-price sync being confirmed. */
  const [pendingSync, setPendingSync] = useState<CombinationLegSync | null>(
    null,
  );
  const [filter, setFilter] = useState<ReviewFilter>("ALL");
  /*
   * ── WHAT AN INLINE EDIT LEAVES BEHIND ─────────────────────────────────────
   * The record the backend answered with, laid over the one the list delivered.
   * A field saved in place changes one route, so refetching both lists to learn
   * what this browser was just told would be a round trip for nothing — the same
   * reason the Ritten list keeps each row's own later answer beside the page it
   * loaded.
   *
   * Dropped as soon as a refetch delivers a new list — see `SavedOverlay`.
   */
  const [savedRoutes, setSavedRoutes] =
    useState<SavedOverlay<RouteConfiguration>>(NO_OVERLAY);
  const [savedCombinations, setSavedCombinations] =
    useState<SavedOverlay<CombinationRouteConfiguration>>(NO_OVERLAY);

  /*
   * ── FIRST LOAD, NOT EVERY LOAD ────────────────────────────────────────────
   * `useAsync` reports loading during a refetch too, while keeping the list it
   * already has. Swapping the table for the loading line on every refetch —
   * after a tick, a delete, a sync — took the whole table out of the page: the
   * document became a few hundred pixels tall, the browser clamped the scroll
   * position to the top, and the list came back there. The loading line is for
   * when there is nothing to show yet; during a refetch the table stays, and
   * with it the operator's place in the list.
   */
  const isFirstLoad =
    (routes.isLoading && routes.data === null) ||
    (combinations.isLoading && combinations.data === null);
  const isRefreshing =
    !isFirstLoad && (routes.isLoading || combinations.isLoading);
  const error = routes.error ?? combinations.error;
  const routeOverlay = overlayFor(savedRoutes, routes.data);
  const combinationOverlay = overlayFor(savedCombinations, combinations.data);
  const configured = (routes.data ?? []).map(
    (route) => routeOverlay.get(route.id) ?? route,
  );
  const configuredCombinations = (combinations.data ?? []).map(
    (combination) => combinationOverlay.get(combination.id) ?? combination,
  );

  /**
   * Runs one change and reports how it went.
   *
   * `failureKey` names the ACTION rather than the error: saving and removing
   * fail differently and an operator reading "Opslaan mislukt" after pressing
   * Verwijderen is being told about something they did not do.
   */
  async function run(
    id: string | null,
    operation: () => Promise<unknown>,
    words: {
      readonly done?: TranslationKey;
      readonly failed?: TranslationKey;
    } = {},
  ) {
    setBusyId(id ?? "new");

    try {
      await operation();
      setDraft(null);
      setCombinationDraft(null);
      onSaved(words.done);
    } catch (error: unknown) {
      onFailed(error, words.failed);
    } finally {
      setBusyId(null);
    }
  }

  function save(): void {
    if (!draft) {
      return;
    }

    const payload = toRoutePayload(draft);

    void run(draft.id, () =>
      draft.id === null
        ? createRouteConfiguration(payload)
        : updateRouteConfiguration(draft.id, payload),
    );
  }

  /**
   * Both legs in one request.
   *
   * The backend writes them in one transaction, so a Combination with a single
   * leg cannot come into being — and this side never has to keep two requests in
   * step or undo the first when the second fails.
   */
  function saveCombination(): void {
    if (!combinationDraft) {
      return;
    }

    // Only ever a new one: a stored Combination is changed in its own rows, and
    // the update those changes go through is `saveLegField`.
    void run(null, () =>
      createCombinationRouteConfiguration({
        legs: combinationDraft.legs.map((leg) => toRoutePayload(leg)),
      }),
    );
  }

  /**
   * Writes the whole configuration to a file the importer can read back.
   *
   * ── BUILT FROM WHAT THE SCREEN SHOWS ──────────────────────────────────────
   * Not from a second endpoint. These two lists ARE the configuration — both are
   * complete, because neither is paginated — so the file says exactly what the
   * table says, and there is no second representation of the same data to keep in
   * step with the first. The format is the bulk import's, so the file goes
   * straight back in.
   */
  function exportJson(): void {
    downloadBlob(
      toRouteConfigurationBlob(
        toRouteConfigurationDocument(configured, configuredCombinations),
      ),
      routeConfigurationFileName(new Date()),
    );
  }

  /**
   * Saves one field of an ordinary route, through the update the form uses.
   *
   * ── THE WHOLE ROUTE GOES, ONE FIELD DIFFERS ───────────────────────────────
   * The endpoint takes a complete configuration — there is no per-field endpoint
   * and this deliberately does not add one — so the other four values are sent
   * exactly as they stand. See `toUpdatedRoutePayload`, which also keeps an
   * unmeasured distance null instead of quietly calling it zero.
   *
   * It does NOT catch: the cell keeps the failure, shows the backend's own words
   * and stays open with what was typed, which is what makes a refusal something
   * an operator can act on rather than something that wiped their work.
   */
  async function saveRouteField(
    route: RouteConfiguration,
    field: RouteField,
    value: string,
  ): Promise<void> {
    const saved = await updateRouteConfiguration(
      route.id,
      toUpdatedRoutePayload(route, field, value),
    );

    setSavedRoutes((current) => withSaved(current, routes.data, saved));
    onReported();
  }

  /**
   * Saves one field of one LEG, through the Combination's own update.
   *
   * ── THE OTHER LEG IS PASSED THROUGH, NOT REBUILT ──────────────────────────
   * That endpoint replaces both legs in one transaction, which is what keeps a
   * Combination from ever having one. So the untouched leg is sent exactly as it
   * stands — read from the record on screen, field for field — and comes out of
   * the transaction with the values it went in with. Editing Leg 1 cannot move
   * Leg 2.
   */
  async function saveLegField(
    combination: CombinationRouteConfiguration,
    legIndex: number,
    field: RouteField,
    value: string,
  ): Promise<void> {
    const saved = await updateCombinationRouteConfiguration(combination.id, {
      legs: combination.legs.map((leg, index) =>
        index === legIndex
          ? toUpdatedRoutePayload(leg, field, value)
          : toRouteValues(leg),
      ),
    });

    setSavedCombinations((current) =>
      withSaved(current, combinations.data, saved),
    );
    onReported();
  }

  /**
   * Deletes the selection in ONE request, which the backend runs as one
   * transaction: all of it, or — when any record is refused — none of it.
   *
   * Not through `run`: a refusal must reach the confirmation, which stays open
   * with the backend's reason, rather than become a message at the top of a page
   * the operator has scrolled away from.
   */
  async function deleteSelection(): Promise<void> {
    await bulkDeleteRouteConfigurations({
      routeIds: selection.routeIds,
      combinationGroupIds: selection.combinationGroupIds,
    });
    selection.clear();
    onSaved("settings.pricing.routes.selection.deleted");
  }

  /**
   * Asks the backend which Combinations a sync of this leg would reach, then
   * asks the operator. The preview writes nothing.
   */
  async function startLegSync(
    combination: CombinationRouteConfiguration,
    legIndex: number,
  ): Promise<void> {
    setBusyId(combination.id);

    try {
      setPendingSync(
        await previewCombinationLegSync(
          combination.id,
          (legIndex + 1) as CombinationLegPosition,
        ),
      );
    } catch (error: unknown) {
      onFailed(error, "settings.pricing.routes.sync.failed");
    } finally {
      setBusyId(null);
    }
  }

  /**
   * Performs the sync the operator confirmed, then refetches — the table stays
   * on screen meanwhile, so the scroll position, the filter, the selection and
   * every review mark stay as they were. Rejects on refusal, so the
   * confirmation stays open with the backend's reason.
   */
  async function confirmLegSync(sync: CombinationLegSync): Promise<void> {
    await syncCombinationLeg(sync.combinationGroupId, sync.legPosition);
    onSaved("settings.pricing.routes.sync.done");
  }

  /** Opens the form the selected type calls for, and closes the other. */
  function add(): void {
    if (type === "COMBINATION") {
      setDraft(null);
      setCombinationDraft({
        ...BLANK_COMBINATION_DRAFT,
        legs: [{ ...BLANK_ROUTE_DRAFT }, { ...BLANK_ROUTE_DRAFT }],
      });

      return;
    }

    setCombinationDraft(null);
    setDraft({ ...BLANK_ROUTE_DRAFT });
  }

  /** Nothing configured at all — as against nothing configured YET being typed. */
  const isEmptyConfiguration =
    configured.length === 0 && configuredCombinations.length === 0;

  /*
   * ── WHAT THE COUNTER COUNTS ───────────────────────────────────────────────
   * CONFIGURATIONS, not rows: a Combination is one record an administrator
   * checks once, however many legs it draws. Counted from the live lists, so the
   * number cannot drift from what the table shows.
   */
  const configurationCount = configured.length + configuredCombinations.length;
  const reviewedCount =
    configured.filter((route) => route.reviewed).length +
    configuredCombinations.filter((combination) => combination.reviewed).length;

  const shownRoutes = configured.filter((route) =>
    matchesFilter(route.reviewed, filter),
  );
  const shownCombinations = configuredCombinations.filter((combination) =>
    matchesFilter(combination.reviewed, filter),
  );

  const isEmpty = isEmptyConfiguration && !draft && !combinationDraft;

  const selection = useRouteSelection({
    shownRouteIds: shownRoutes.map((route) => route.id),
    shownCombinationIds: shownCombinations.map((combination) => combination.id),
  });

  return (
    <section className="rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          {t("settings.pricing.routes.title")}
        </h2>

        <div className="flex flex-wrap items-center gap-3">
          {/*
            The kind is chosen BEFORE the form appears, because the two forms ask
            for different things: one route, or a pair of legs. A single form with
            an optional second half would let a Combination be saved with one leg.
          */}
          <fieldset className="flex items-center gap-3">
            <legend className="sr-only">
              {t("settings.pricing.routes.type.label")}
            </legend>
            <span aria-hidden="true" className="text-xs text-muted">
              {`${t("settings.pricing.routes.type.label")}:`}
            </span>
            {ROUTE_TYPES.map((candidate) => (
              <label
                key={candidate}
                className="flex items-center gap-1.5 text-xs text-foreground"
              >
                <input
                  type="radio"
                  name="route-type"
                  value={candidate}
                  checked={type === candidate}
                  onChange={() => setType(candidate)}
                />
                {t(TYPE_LABELS[candidate])}
              </label>
            ))}
          </fieldset>

          <button
            type="button"
            onClick={add}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-hover"
          >
            {t("settings.pricing.routes.add")}
          </button>

          {/*
            Beside the single-route action rather than hidden away: pasting a
            price list is how a route table is first filled, and typing forty
            routes one at a time is the thing this replaces.
          */}
          <button
            type="button"
            onClick={() => setIsImporting(true)}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-hover"
          >
            {t("settings.pricing.routes.bulk.add")}
          </button>

          {/*
            Disabled while there is nothing to export: an empty file is not a
            backup, and offering one invites the question of what went wrong.
          */}
          <button
            type="button"
            disabled={isEmptyConfiguration}
            onClick={exportJson}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-hover disabled:opacity-50"
          >
            {t("settings.pricing.routes.export")}
          </button>
        </div>
      </div>
      {/*
        Direction is part of the identity, and an operator cannot see that from
        a table of rows. Saying it once here is cheaper than a support call
        about a route that "already exists".
      */}
      <p className="mt-1 text-[11px] text-muted">
        {t("settings.pricing.routes.directionNote")}
      </p>

      {/*
        The progress line and the filter that goes with it. Shown only once there
        is something to be in progress ON: an empty configuration has nothing to
        count and nothing to filter.
      */}
      {!isEmptyConfiguration ? (
        <RouteReviewProgress
          reviewedCount={reviewedCount}
          configurationCount={configurationCount}
          filter={filter}
          onFilterChange={setFilter}
        />
      ) : null}

      {isFirstLoad ? (
        <LoadingState label={t("settings.pricing.loading")} />
      ) : null}

      {!isFirstLoad && error ? (
        <ErrorState
          error={error}
          onRetry={() => {
            routes.reload();
            combinations.reload();
          }}
        />
      ) : null}

      {!isFirstLoad && !error ? (
        <>
          {!isEmptyConfiguration ? (
            <RouteSelectionToolbar
              selection={selection}
              hasShownRecords={shownRoutes.length + shownCombinations.length > 0}
              onDelete={() => setIsDeletingSelection(true)}
            />
          ) : null}

          <div className="mt-3 overflow-x-auto" aria-busy={isRefreshing}>
            <table className="w-full min-w-[760px] text-left text-sm">
              <caption className="sr-only">
                {t("settings.pricing.routes.title")}
              </caption>
              <RouteTableHead />
              <tbody>
                {draft && draft.id === null ? (
                  <RouteForm
                    draft={draft}
                    isBusy={busyId === "new"}
                    onChange={setDraft}
                    onSave={save}
                    onCancel={() => setDraft(null)}
                  />
                ) : null}

                {shownRoutes.map((route) =>
                  draft && draft.id === route.id ? (
                    <RouteForm
                      key={route.id}
                      draft={draft}
                      isBusy={busyId === route.id}
                      onChange={setDraft}
                      onSave={save}
                      onCancel={() => setDraft(null)}
                    />
                  ) : (
                    <RouteRow
                      key={route.id}
                      route={route}
                      isBusy={busyId === route.id}
                      isSelected={selection.isRouteSelected(route.id)}
                      onToggleSelected={() => selection.toggleRoute(route.id)}
                      onDelete={() => setDeleting(route)}
                      onSaveField={(field, value) =>
                        saveRouteField(route, field, value)
                      }
                      onReview={(reviewed) =>
                        void run(
                          route.id,
                          () =>
                            markRouteConfigurationReviewed(route.id, reviewed),
                          { done: "settings.pricing.routes.reviewSaved" },
                        )
                      }
                    />
                  ),
                )}
              </tbody>

              {/*
                Each Combination is one `<tbody>` of its own: the same rows, the
                same borders and the same type as an ordinary route, with a quiet
                header row saying the two belong together. None is ever left out:
                a Combination is edited in place, so no form ever stands in for a
                row.
              */}
              {shownCombinations.map((combination, index) => (
                <CombinationRows
                  key={combination.id}
                  combination={combination}
                  index={index}
                  isBusy={busyId === combination.id}
                  isSelected={selection.isCombinationSelected(combination.id)}
                  columnCount={ROUTE_COLUMN_COUNT}
                  onToggleSelected={() =>
                    selection.toggleCombination(combination.id)
                  }
                  onDelete={() => setDeletingCombination(combination)}
                  onSyncLeg={(legIndex) =>
                    void startLegSync(combination, legIndex)
                  }
                  onSaveLegField={(legIndex, field, value) =>
                    saveLegField(combination, legIndex, field, value)
                  }
                  onReview={(reviewed) =>
                    void run(
                      combination.id,
                      () =>
                        markCombinationRouteConfigurationReviewed(
                          combination.id,
                          reviewed,
                        ),
                      { done: "settings.pricing.routes.reviewSaved" },
                    )
                  }
                />
              ))}
            </table>
          </div>

          {combinationDraft ? (
            <CombinationRouteForm
              draft={combinationDraft}
              isBusy={busyId === "new"}
              onChange={setCombinationDraft}
              onSave={saveCombination}
              onCancel={() => setCombinationDraft(null)}
            />
          ) : null}

          {isEmpty ? (
            <EmptyState
              title={t("settings.pricing.routes.empty")}
              description={t("settings.pricing.routes.emptyDescription")}
            />
          ) : null}
        </>
      ) : null}

      {/*
        The application's own confirmation, as the Custom values page uses for
        the same kind of action: it can name the route that is about to go, mark
        the confirming button destructive, and say what deleting does NOT touch.
      */}
      {deleting ? (
        <ConfirmDialog
          titleKey="settings.pricing.routes.deleteTitle"
          descriptionKey="settings.pricing.routes.deleteDescription"
          consequenceKey="settings.pricing.routes.deleteConsequence"
          confirmKey="settings.pricing.routes.delete"
          tone="danger"
          onConfirm={async () => {
            await run(
              deleting.id,
              () => deleteRouteConfiguration(deleting.id),
              {
                done: "settings.pricing.routes.deleted",
                failed: "settings.pricing.routes.deleteFailed",
              },
            );
            setDeleting(null);
          }}
          onClose={() => setDeleting(null)}
        >
          <span className="font-medium text-foreground">
            {`${deleting.departure} → ${deleting.destination}`}
          </span>
        </ConfirmDialog>
      ) : null}

      {isDeletingSelection ? (
        <BulkDeleteDialog
          routeNames={shownRoutes
            .filter((route) => selection.routeIds.includes(route.id))
            .map((route) => `${route.departure} → ${route.destination}`)}
          combinationNames={shownCombinations
            .filter((combination) =>
              selection.combinationGroupIds.includes(combination.id),
            )
            .map((combination) =>
              combinationName(
                t("settings.pricing.routes.combinations.label"),
                configuredCombinations.indexOf(combination),
                combination,
              ),
            )}
          onConfirm={deleteSelection}
          onClose={() => setIsDeletingSelection(false)}
        />
      ) : null}

      {pendingSync ? (
        <CombinationLegSyncDialog
          preview={pendingSync}
          onConfirm={() => confirmLegSync(pendingSync)}
          onClose={() => setPendingSync(null)}
        />
      ) : null}

      {isImporting ? (
        <BulkRouteImportDialog
          onImported={() => {
            setIsImporting(false);
            onSaved();
          }}
          onClose={() => setIsImporting(false)}
        />
      ) : null}

      {deletingCombination ? (
        <CombinationDeleteDialog
          combination={deletingCombination}
          index={configuredCombinations.indexOf(deletingCombination)}
          onConfirm={async () => {
            await run(
              deletingCombination.id,
              () => deleteCombinationRouteConfiguration(deletingCombination.id),
              {
                done: "settings.pricing.routes.deleted",
                failed: "settings.pricing.routes.deleteFailed",
              },
            );
            setDeletingCombination(null);
          }}
          onClose={() => setDeletingCombination(null)}
        />
      ) : null}
    </section>
  );
}

/** "Combination #2: Antwerp → Kallo / Kallo → Antwerp", as the list names it. */
function combinationName(
  label: string,
  index: number,
  combination: CombinationRouteConfiguration,
): string {
  return `${label} #${index + 1}: ${combination.legs
    .map((leg) => `${leg.departure} → ${leg.destination}`)
    .join(" / ")}`;
}
