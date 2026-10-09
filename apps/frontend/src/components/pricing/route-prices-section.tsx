"use client";

import { useEffect, useState } from "react";

import { BulkRouteImportDialog } from "@/components/pricing/bulk-route-import-dialog";
import { CombinationLegSyncDialog } from "@/components/pricing/combination-leg-sync-dialog";
import {
  BLANK_COMBINATION_DRAFT,
  CombinationDeleteDialog,
  type CombinationDraft,
} from "@/components/pricing/combination-routes";
import { CombinationsTable } from "@/components/pricing/combinations-table";
import { NormalRoutesTable } from "@/components/pricing/normal-routes-table";
import {
  matchesFilter,
  RouteReviewProgress,
} from "@/components/pricing/route-review-progress";
import {
  BulkDeleteDialog,
  RouteSelectionToolbar,
} from "@/components/pricing/route-selection-toolbar";
import {
  COMBINATIONS_OPEN_PARAM,
  NORMAL_ROUTES_OPEN_PARAM,
  ROUTE_REVIEW_FILTER_PARAM,
  ROUTE_SEARCH_PARAM,
} from "@/components/pricing/route-prices-url-state";
import { useRouteSelection } from "@/components/pricing/use-route-selection";
import { ConfirmDialog } from "@/components/ritten/confirm-dialog";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import type { useAsync } from "@/hooks/use-async";
import { useUrlState } from "@/hooks/use-url-state";
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
  toOverStPayload,
  toRoutePayload,
  toRouteValues,
  toUpdatedOverStPayload,
  toUpdatedRoutePayload,
  type OverStField,
  type RouteDraft,
  type RouteField,
} from "@/lib/pricing/route-draft";
import {
  routeConfigurationFileName,
  toRouteConfigurationBlob,
  toRouteConfigurationDocument,
} from "@/lib/pricing/route-export";
import {
  matchesCombinationSearch,
  matchesRouteSearch,
} from "@/lib/pricing/route-search";
import {
  NO_OVERLAY,
  overlayFor,
  withSaved,
  type SavedOverlay,
} from "@/lib/pricing/saved-overlay";

type RoutesState = ReturnType<
  typeof useAsync<Awaited<ReturnType<typeof listRouteConfigurations>>>
>;
type CombinationsState = ReturnType<
  typeof useAsync<
    Awaited<ReturnType<typeof listCombinationRouteConfigurations>>
  >
>;

/**
 * Routeprijzen — what each route costs.
 *
 * ── TWO SECTIONS, EACH ITS OWN ──────────────────────────────────────────────
 * "Normale ritten" and "Combi's" are separate sections that open and close on
 * their own. An ordinary route is one row with its Tarief, Toll and Tunnel. A
 * Combination is ONE record with two legs — each with its own Tarief, Toll and
 * Tunnel — and Over ST, the Combination's own amounts. The same road may appear
 * in both sections: the backend reads them in different pricing contexts.
 *
 * ── ONE SEARCH ACROSS BOTH ──────────────────────────────────────────────────
 * The search filters both sections by Van and Naar (a Combination by either
 * leg, shown whole), together with the review filter. A section with results
 * opens when a search starts, so a match is never hidden behind a closed one.
 *
 * ── AND NOTHING HERE CALCULATES ─────────────────────────────────────────────
 * No amount is derived, summed or converted in the browser. Every value is the
 * one an operator stated, shown as the backend stored it.
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
  /** One record changed in place and the backend already said what it now is. */
  onReported: (messageKey?: TranslationKey) => void;
  onFailed: (error: unknown, messageKey?: TranslationKey) => void;
}) {
  const t = useTranslation();
  const [draft, setDraft] = useState<RouteDraft | null>(null);
  const [combinationDraft, setCombinationDraft] =
    useState<CombinationDraft | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<RouteConfiguration | null>(null);
  const [deletingCombination, setDeletingCombination] =
    useState<CombinationRouteConfiguration | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isDeletingSelection, setIsDeletingSelection] = useState(false);
  const [pendingSync, setPendingSync] = useState<CombinationLegSync | null>(
    null,
  );
  // In the address, so Back finds the same rows open the same way.
  const [filter, setFilter] = useUrlState(ROUTE_REVIEW_FILTER_PARAM);
  const [search, setSearch] = useUrlState(ROUTE_SEARCH_PARAM);
  const [isNormalOpen, setIsNormalOpen] = useUrlState(NORMAL_ROUTES_OPEN_PARAM);
  const [isCombinationsOpen, setIsCombinationsOpen] = useUrlState(
    COMBINATIONS_OPEN_PARAM,
  );
  /*
   * ── A NEW COMBINATION IS SHOWN FIRST — FOR NOW ────────────────────────────
   * The stored order is oldest first, and stays the order. A Combination added
   * in this visit is shown at the top so the operator sees what they just
   * created; the next visit lists it in its stored place again.
   */
  const [recentCombinationIds, setRecentCombinationIds] = useState<
    readonly string[]
  >([]);
  /*
   * ── WHAT AN INLINE EDIT LEAVES BEHIND ─────────────────────────────────────
   * The record the backend answered with, laid over the one the list delivered,
   * so an edit of one value needs no refetch. Dropped as soon as a refetch
   * delivers a new list — see `SavedOverlay`.
   */
  const [savedRoutes, setSavedRoutes] =
    useState<SavedOverlay<RouteConfiguration>>(NO_OVERLAY);
  const [savedCombinations, setSavedCombinations] =
    useState<SavedOverlay<CombinationRouteConfiguration>>(NO_OVERLAY);

  /*
   * ── FIRST LOAD, NOT EVERY LOAD ────────────────────────────────────────────
   * During a refetch the tables stay on screen, and with them the operator's
   * place in the list: swapping them for a loading line would shrink the page
   * and clamp the scroll position to the top.
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

  const shownRoutes = configured.filter(
    (route) =>
      matchesFilter(route.reviewed, filter) && matchesRouteSearch(route, search),
  );
  const shownCombinations = withRecentFirst(
    configuredCombinations.filter(
      (combination) =>
        matchesFilter(combination.reviewed, filter) &&
        matchesCombinationSearch(combination, search),
    ),
    recentCombinationIds,
  );
  const hasSearch = search.trim() !== "";

  /*
   * A section that holds matches opens when the search changes, so a result is
   * never hidden behind a closed section. Closing it again is still the
   * operator's choice.
   */
  useEffect(() => {
    if (search.trim() === "") {
      return;
    }

    if (shownRoutes.length > 0) {
      setIsNormalOpen(true);
    }

    if (shownCombinations.length > 0) {
      setIsCombinationsOpen(true);
    }
    // Only a change of the search opens a section; a refetch must not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const selection = useRouteSelection({
    shownRouteIds: shownRoutes.map((route) => route.id),
    shownCombinationIds: shownCombinations.map((combination) => combination.id),
  });

  /**
   * Runs one change and reports how it went. `words` name the ACTION rather
   * than the error, so a failure says what the operator did.
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

  function saveRoute(): void {
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

  /** Both legs and Over ST in one request; the backend writes them together. */
  function saveCombination(): void {
    if (!combinationDraft) {
      return;
    }

    void run(null, async () => {
      const created = await createCombinationRouteConfiguration({
        legs: combinationDraft.legs.map((leg) => toRoutePayload(leg)),
        overSt: toOverStPayload(combinationDraft.overSt),
      });

      setRecentCombinationIds((current) => [created.id, ...current]);
    });
  }

  /** The file the importer reads back, built from the lists the screen shows. */
  function exportJson(): void {
    downloadBlob(
      toRouteConfigurationBlob(
        toRouteConfigurationDocument(configured, configuredCombinations),
      ),
      routeConfigurationFileName(new Date()),
    );
  }

  /**
   * One field of an ordinary route, through the update the form uses: the
   * whole route goes, one field differs. Rejects so the cell keeps the failure.
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
   * Writes a Combination through its own update and lays the answer over the
   * list. The other leg is passed through as it stands; Over ST travels only
   * when `overSt` is given, so a leg edit never touches it.
   */
  async function saveCombinationEdit(
    combination: CombinationRouteConfiguration,
    legs: ReturnType<typeof toRouteValues>[],
    overSt?: ReturnType<typeof toUpdatedOverStPayload>,
  ): Promise<void> {
    const saved = await updateCombinationRouteConfiguration(combination.id, {
      legs,
      ...(overSt ? { overSt } : {}),
    });

    setSavedCombinations((current) =>
      withSaved(current, combinations.data, saved),
    );
    onReported();
  }

  function saveLegField(
    combination: CombinationRouteConfiguration,
    legIndex: number,
    field: RouteField,
    value: string,
  ): Promise<void> {
    return saveCombinationEdit(
      combination,
      combination.legs.map((leg, index) =>
        index === legIndex
          ? toUpdatedRoutePayload(leg, field, value)
          : toRouteValues(leg),
      ),
    );
  }

  function saveOverStField(
    combination: CombinationRouteConfiguration,
    field: OverStField,
    value: string,
  ): Promise<void> {
    return saveCombinationEdit(
      combination,
      combination.legs.map(toRouteValues),
      toUpdatedOverStPayload(combination.overSt, field, value),
    );
  }

  /** The selection in ONE request: all of it, or none of it. */
  async function deleteSelection(): Promise<void> {
    await bulkDeleteRouteConfigurations({
      routeIds: selection.routeIds,
      combinationGroupIds: selection.combinationGroupIds,
    });
    selection.clear();
    onSaved("settings.pricing.routes.selection.deleted");
  }

  /** Asks the backend which Combinations a sync would reach. Writes nothing. */
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

  async function confirmLegSync(sync: CombinationLegSync): Promise<void> {
    await syncCombinationLeg(sync.combinationGroupId, sync.legPosition);
    onSaved("settings.pricing.routes.sync.done");
  }

  function addRoute(): void {
    setIsNormalOpen(true);
    setDraft({ ...BLANK_ROUTE_DRAFT });
  }

  function addCombination(): void {
    setIsCombinationsOpen(true);
    setCombinationDraft({
      ...BLANK_COMBINATION_DRAFT,
      legs: [{ ...BLANK_ROUTE_DRAFT }, { ...BLANK_ROUTE_DRAFT }],
      overSt: { ...BLANK_COMBINATION_DRAFT.overSt },
    });
  }

  const isEmptyConfiguration =
    configured.length === 0 && configuredCombinations.length === 0;
  const configurationCount = configured.length + configuredCombinations.length;
  const reviewedCount =
    configured.filter((route) => route.reviewed).length +
    configuredCombinations.filter((combination) => combination.reviewed).length;
  const numberOf = (combination: CombinationRouteConfiguration) =>
    configuredCombinations.findIndex((each) => each.id === combination.id);
  const actionClass =
    "rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-hover disabled:opacity-50";

  return (
    <section className="rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          {t("settings.pricing.routes.title")}
        </h2>

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => setIsImporting(true)} className={actionClass}>
            {t("settings.pricing.routes.bulk.add")}
          </button>
          {/* An empty file is not a backup, so there is nothing to export yet. */}
          <button
            type="button"
            disabled={isEmptyConfiguration}
            onClick={exportJson}
            className={actionClass}
          >
            {t("settings.pricing.routes.export")}
          </button>
        </div>
      </div>
      <p className="mt-1 text-[11px] text-muted">
        {t("settings.pricing.routes.directionNote")}
      </p>

      <label className="mt-3 block">
        <span className="mb-1 block text-xs font-medium text-muted">
          {t("settings.pricing.routes.search.label")}
        </span>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("settings.pricing.routes.search.placeholder")}
          className="w-full max-w-md rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
        />
      </label>

      {!isEmptyConfiguration ? (
        <RouteReviewProgress
          reviewedCount={reviewedCount}
          configurationCount={configurationCount}
          filter={filter}
          onFilterChange={setFilter}
        />
      ) : null}

      {isFirstLoad ? <LoadingState label={t("settings.pricing.loading")} /> : null}

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

          <CollapsibleSection
            title={t("settings.pricing.routes.sections.normal")}
            count={shownRoutes.length}
            isOpen={isNormalOpen}
            onToggle={() => setIsNormalOpen((open) => !open)}
            actions={
              <button type="button" onClick={addRoute} className={actionClass}>
                {t("settings.pricing.routes.add")}
              </button>
            }
          >
            <NormalRoutesTable
              routes={shownRoutes}
              draft={draft}
              busyId={busyId}
              isRefreshing={isRefreshing}
              hasSearch={hasSearch}
              isRouteSelected={selection.isRouteSelected}
              onToggleSelected={selection.toggleRoute}
              onDraftChange={setDraft}
              onSave={saveRoute}
              onCancel={() => setDraft(null)}
              onDelete={setDeleting}
              onSaveField={saveRouteField}
              onReview={(route, reviewed) =>
                void run(
                  route.id,
                  () => markRouteConfigurationReviewed(route.id, reviewed),
                  { done: "settings.pricing.routes.reviewSaved" },
                )
              }
            />
          </CollapsibleSection>

          <CollapsibleSection
            title={t("settings.pricing.routes.sections.combinations")}
            count={shownCombinations.length}
            isOpen={isCombinationsOpen}
            onToggle={() => setIsCombinationsOpen((open) => !open)}
            actions={
              <button type="button" onClick={addCombination} className={actionClass}>
                {t("settings.pricing.routes.combinations.add")}
              </button>
            }
          >
            <CombinationsTable
              combinations={shownCombinations}
              numberOf={numberOf}
              draft={combinationDraft}
              busyId={busyId}
              isRefreshing={isRefreshing}
              hasSearch={hasSearch}
              isCombinationSelected={selection.isCombinationSelected}
              onToggleSelected={selection.toggleCombination}
              onDraftChange={setCombinationDraft}
              onSave={saveCombination}
              onCancel={() => setCombinationDraft(null)}
              onDelete={setDeletingCombination}
              onSyncLeg={(combination, legIndex) =>
                void startLegSync(combination, legIndex)
              }
              onSaveLegField={saveLegField}
              onSaveOverStField={saveOverStField}
              onReview={(combination, reviewed) =>
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
          </CollapsibleSection>

          {isEmptyConfiguration && !draft && !combinationDraft ? (
            <EmptyState
              title={t("settings.pricing.routes.empty")}
              description={t("settings.pricing.routes.emptyDescription")}
            />
          ) : null}
        </>
      ) : null}

      {deleting ? (
        <ConfirmDialog
          titleKey="settings.pricing.routes.deleteTitle"
          descriptionKey="settings.pricing.routes.deleteDescription"
          consequenceKey="settings.pricing.routes.deleteConsequence"
          confirmKey="settings.pricing.routes.delete"
          tone="danger"
          onConfirm={async () => {
            await run(deleting.id, () => deleteRouteConfiguration(deleting.id), {
              done: "settings.pricing.routes.deleted",
              failed: "settings.pricing.routes.deleteFailed",
            });
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
                numberOf(combination),
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
          index={numberOf(deletingCombination)}
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

/** The Combinations added in this visit first (newest first), then the rest in stored order. */
function withRecentFirst(
  combinations: readonly CombinationRouteConfiguration[],
  recentIds: readonly string[],
): CombinationRouteConfiguration[] {
  const recent = recentIds
    .map((id) => combinations.find((combination) => combination.id === id))
    .filter((combination): combination is CombinationRouteConfiguration =>
      Boolean(combination),
    );

  return [
    ...recent,
    ...combinations.filter((combination) => !recentIds.includes(combination.id)),
  ];
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
