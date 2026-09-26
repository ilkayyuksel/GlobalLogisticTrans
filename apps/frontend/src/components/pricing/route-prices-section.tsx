"use client";

import { useState } from "react";

import { BulkRouteImportDialog } from "@/components/pricing/bulk-route-import-dialog";
import {
  BLANK_COMBINATION_DRAFT,
  CombinationDeleteDialog,
  CombinationRouteForm,
  CombinationRouteList,
  combinationDraftOf,
  type CombinationDraft,
} from "@/components/pricing/combination-routes";
import { ConfirmDialog } from "@/components/ritten/confirm-dialog";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import type { useAsync } from "@/hooks/use-async";
import {
  createCombinationRouteConfiguration,
  createRouteConfiguration,
  deleteCombinationRouteConfiguration,
  deleteRouteConfiguration,
  listCombinationRouteConfigurations,
  listRouteConfigurations,
  updateCombinationRouteConfiguration,
  updateRouteConfiguration,
  type CombinationRouteConfiguration,
  type RouteConfiguration,
} from "@/lib/api/route-configuration";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { TranslationKey } from "@/lib/i18n/translations";
import {
  BLANK_ROUTE_DRAFT,
  draftOf,
  toRoutePayload,
  type RouteDraft,
} from "@/lib/pricing/route-draft";

type RoutesState = ReturnType<
  typeof useAsync<Awaited<ReturnType<typeof listRouteConfigurations>>>
>;
type CombinationsState = ReturnType<
  typeof useAsync<Awaited<ReturnType<typeof listCombinationRouteConfigurations>>>
>;

/** The two kinds of route an operator can configure. */
const ROUTE_TYPES = ["NORMAL", "COMBINATION"] as const;

type RouteType = (typeof ROUTE_TYPES)[number];

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
  onFailed,
}: {
  routes: RoutesState;
  combinations: CombinationsState;
  onSaved: () => void;
  onFailed: (error: unknown) => void;
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

  const isLoading = routes.isLoading || combinations.isLoading;
  const error = routes.error ?? combinations.error;
  const configured = routes.data ?? [];
  const configuredCombinations = combinations.data ?? [];

  async function run(id: string | null, operation: () => Promise<unknown>) {
    setBusyId(id ?? "new");

    try {
      await operation();
      setDraft(null);
      setCombinationDraft(null);
      onSaved();
    } catch (error: unknown) {
      onFailed(error);
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

    const payload = {
      legs: combinationDraft.legs.map((leg) => toRoutePayload(leg)),
    };

    void run(combinationDraft.id, () =>
      combinationDraft.id === null
        ? createCombinationRouteConfiguration(payload)
        : updateCombinationRouteConfiguration(combinationDraft.id, payload),
    );
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

  const isEmpty =
    configured.length === 0 &&
    configuredCombinations.length === 0 &&
    !draft &&
    !combinationDraft;

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

      {isLoading ? <LoadingState label={t("settings.pricing.loading")} /> : null}

      {!isLoading && error ? (
        <ErrorState
          error={error}
          onRetry={() => {
            routes.reload();
            combinations.reload();
          }}
        />
      ) : null}

      {!isLoading && !error ? (
        <>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <caption className="sr-only">
                {t("settings.pricing.routes.title")}
              </caption>
              <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t("settings.pricing.routes.from")}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t("settings.pricing.routes.to")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    {t("settings.pricing.routes.tarief")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    {t("settings.pricing.routes.kilometres")}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    {t("settings.pricing.routes.tunnel")}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t("settings.pricing.routes.actions")}
                  </th>
                </tr>
              </thead>
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

                {configured.map((route) =>
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
                      onEdit={() => {
                        setCombinationDraft(null);
                        setDraft(draftOf(route));
                      }}
                      onDelete={() => setDeleting(route)}
                    />
                  ),
                )}
              </tbody>
            </table>
          </div>

          {combinationDraft ? (
            <CombinationRouteForm
              draft={combinationDraft}
              isBusy={busyId === (combinationDraft.id ?? "new")}
              onChange={setCombinationDraft}
              onSave={saveCombination}
              onCancel={() => setCombinationDraft(null)}
            />
          ) : null}

          <CombinationRouteList
            combinations={configuredCombinations}
            editingId={combinationDraft?.id ?? null}
            busyId={busyId}
            onEdit={(combination) => {
              setDraft(null);
              setCombinationDraft(combinationDraftOf(combination));
            }}
            onDelete={setDeletingCombination}
          />

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
            await run(deleting.id, () => deleteRouteConfiguration(deleting.id));
            setDeleting(null);
          }}
          onClose={() => setDeleting(null)}
        >
          <span className="font-medium text-foreground">
            {`${deleting.departure} → ${deleting.destination}`}
          </span>
        </ConfirmDialog>
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
            await run(deletingCombination.id, () =>
              deleteCombinationRouteConfiguration(deletingCombination.id),
            );
            setDeletingCombination(null);
          }}
          onClose={() => setDeletingCombination(null)}
        />
      ) : null}
    </section>
  );
}

function RouteRow({
  route,
  isBusy,
  onEdit,
  onDelete,
}: {
  route: RouteConfiguration;
  isBusy: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslation();

  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-3 py-2 text-foreground">{route.departure}</td>
      <td className="px-3 py-2 text-foreground">{route.destination}</td>
      <td className="px-3 py-2 text-right tabular-nums text-secondary">
        {route.tarief}
      </td>
      {/*
        A route configured before distances existed has none, and no toll is
        charged for it until somebody states one. An em dash says that plainly;
        a 0 would claim somebody had decided the road is free.
      */}
      <td className="px-3 py-2 text-right tabular-nums text-secondary">
        {route.kilometres ?? "—"}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-secondary">
        {route.tunnel}
      </td>
      <td className="px-3 py-2">
        <span className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={isBusy}
            onClick={onEdit}
            aria-label={`${t("settings.pricing.routes.edit")} ${route.departure} ${route.destination}`}
            className="rounded-md border border-border px-2 py-0.5 text-xs font-medium text-foreground hover:bg-hover disabled:opacity-50"
          >
            {t("settings.pricing.routes.edit")}
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={onDelete}
            aria-label={`${t("settings.pricing.routes.delete")} ${route.departure} ${route.destination}`}
            className="rounded-md border border-danger/40 px-2 py-0.5 text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
          >
            {t("settings.pricing.routes.delete")}
          </button>
        </span>
      </td>
    </tr>
  );
}

/**
 * The add / edit row for an ordinary route.
 *
 * Van and Naar are free TEXT. There is no terminal master data in this system
 * and no city list, so a dropdown could only ever offer a guess — the operator
 * types what the route is, and the backend matches a terminal canonically.
 */
function RouteForm({
  draft,
  isBusy,
  onChange,
  onSave,
  onCancel,
}: {
  draft: RouteDraft;
  isBusy: boolean;
  onChange: (draft: RouteDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const t = useTranslation();

  const amountInput = (
    field: "tarief" | "kilometres" | "tunnel",
    labelKey: TranslationKey,
  ) => (
    <td className="px-3 py-2">
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step="0.01"
        aria-label={t(labelKey)}
        value={draft[field]}
        onChange={(event) => onChange({ ...draft, [field]: event.target.value })}
        className="w-24 rounded-md border border-border bg-card px-2 py-1 text-right text-sm text-foreground"
      />
    </td>
  );

  return (
    <tr className="border-b border-border bg-hover/40 last:border-0">
      <td className="px-3 py-2">
        <input
          type="text"
          aria-label={t("settings.pricing.routes.from")}
          value={draft.departure}
          onChange={(event) =>
            onChange({ ...draft, departure: event.target.value })
          }
          className="w-40 rounded-md border border-border bg-card px-2 py-1 text-sm text-foreground"
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="text"
          aria-label={t("settings.pricing.routes.to")}
          value={draft.destination}
          onChange={(event) =>
            onChange({ ...draft, destination: event.target.value })
          }
          className="w-40 rounded-md border border-border bg-card px-2 py-1 text-sm text-foreground"
        />
      </td>
      {amountInput("tarief", "settings.pricing.routes.tarief")}
      {amountInput("kilometres", "settings.pricing.routes.kilometres")}
      {amountInput("tunnel", "settings.pricing.routes.tunnel")}
      {/* The Acties column: the form's own two buttons stand in its place. */}
      <td className="px-3 py-2">
        <span className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={isBusy}
            onClick={onSave}
            className="rounded-md bg-primary px-2 py-0.5 text-xs font-medium text-white hover:bg-primary-hover disabled:opacity-50"
          >
            {isBusy ? t("settings.pricing.saving") : t("settings.pricing.save")}
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={onCancel}
            className="rounded-md border border-border px-2 py-0.5 text-xs font-medium text-foreground hover:bg-hover disabled:opacity-50"
          >
            {t("settings.pricing.cancel")}
          </button>
        </span>
      </td>
    </tr>
  );
}
