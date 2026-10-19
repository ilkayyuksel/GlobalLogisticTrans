"use client";

import { useCallback, useState } from "react";

import { RittenDialog } from "@/components/ritten/ritten-dialog";
import { useAsync } from "@/hooks/use-async";
import { ApiError, userFacingMessage } from "@/lib/api/client";
import { chooseTripRoute } from "@/lib/api/pricing";
import {
  listCombinationRouteConfigurations,
  listRouteConfigurations,
} from "@/lib/api/route-configuration";
import type { ManualRouteChoiceKind, Trip } from "@/lib/api/types";
import { useTranslation } from "@/lib/i18n/language-provider";
import { matchesCombinationSearch, matchesRouteSearch } from "@/lib/pricing/route-search";

/** One route the operator can pick: what identifies it, and nothing about money. */
interface RouteOption {
  readonly id: string;
  readonly label: string;
}

/**
 * "Route kiezen" for a Trip whose automatic match is unusable.
 *
 * ── THE SAME LISTS AND THE SAME SEARCH AS ROUTEPRIJZEN ──────────────────────
 * The routes come from the endpoints the Routeprijzen page reads, and the
 * search is that page's own (`matchesRouteSearch`, `matchesCombinationSearch`)
 * — one search, not a second one with other rules. Only the roads are shown:
 * no Tarief, no Toll, no Tunnel.
 *
 * WHICH KIND is the backend's answer (`routeMatch.manualChoice`): an ordinary
 * route for a Trip in no group, a Combination for a grouped one. Nothing here
 * decides it, and nothing here decides which leg a Trip is — the backend
 * derives it from the roads, and only when it cannot (422) is the operator
 * asked. Pricing is the backend's too: this sends the choice and shows the
 * answer.
 */
export function RouteChoiceDialog({
  trip,
  kind,
  onChosen,
  onClose,
}: {
  trip: Trip;
  kind: ManualRouteChoiceKind;
  /** The choice was stored and priced; the list must show what it now is. */
  onChosen: () => void;
  onClose: () => void;
}) {
  const t = useTranslation();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [needsLeg, setNeedsLeg] = useState(false);
  const [legPosition, setLegPosition] = useState<1 | 2 | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const routes = useAsync(
    useCallback(
      async (signal: AbortSignal): Promise<RouteOption[]> =>
        kind === "NORMAL"
          ? (await listRouteConfigurations(signal)).map((route) => ({
              id: route.id,
              label: `${route.departure} → ${route.destination}`,
              search: route,
            })).map(({ id, label }) => ({ id, label }))
          : (await listCombinationRouteConfigurations(signal)).map((combination, index) => ({
              id: combination.id,
              // Numbered as the Routeprijzen page numbers them, in stored order.
              label: `${t("ritten.routeChoice.combination")} #${index + 1}: ${combination.legs
                .map((leg) => `${leg.departure} → ${leg.destination}`)
                .join(" / ")}`,
            })),
      // The kind decides the list; the translation only labels it.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [kind],
    ),
    [kind],
  );
  const searchable = useAsync(
    useCallback(
      (signal: AbortSignal) =>
        kind === "NORMAL"
          ? listRouteConfigurations(signal).then((list) =>
              new Set(list.filter((route) => matchesRouteSearch(route, search)).map((route) => route.id)),
            )
          : listCombinationRouteConfigurations(signal).then((list) =>
              new Set(
                list
                  .filter((combination) => matchesCombinationSearch(combination, search))
                  .map((combination) => combination.id),
              ),
            ),
      [kind, search],
    ),
    [kind, search],
  );

  const shown = (routes.data ?? []).filter((option) => searchable.data?.has(option.id) ?? true);

  async function apply(): Promise<void> {
    if (!selectedId || isSaving) {
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await chooseTripRoute(
        trip.id,
        kind === "NORMAL"
          ? { routePricingId: selectedId }
          : { combinationRouteGroupId: selectedId, ...(legPosition ? { legPosition } : {}) },
      );
      onChosen();
    } catch (caught: unknown) {
      // The roads do not say which leg this Trip is: the operator is asked.
      if (caught instanceof ApiError && caught.code === "UNPROCESSABLE_ENTITY") {
        setNeedsLeg(true);
      }
      setError(userFacingMessage(caught));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <RittenDialog title={`${t("ritten.routeChoice.title")} ${trip.bookingNumber ?? ""}`.trim()} onClose={onClose}>
      <p className="text-sm text-secondary">{t(`ritten.routeChoice.description.${kind}`)}</p>

      <label className="mt-3 block">
        <span className="mb-1 block text-xs font-medium text-muted">{t("ritten.routeChoice.search")}</span>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
        />
      </label>

      <RouteOptions
        options={shown}
        isLoading={routes.isLoading && routes.data === null}
        hasFailed={routes.error !== null}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />

      {needsLeg ? (
        <fieldset className="mt-3">
          <legend className="text-sm font-medium text-foreground">{t("ritten.routeChoice.legQuestion")}</legend>
          <div className="mt-1 flex gap-4">
            {([1, 2] as const).map((position) => (
              <label key={position} className="flex items-center gap-1.5 text-sm text-foreground">
                <input
                  type="radio"
                  name="route-choice-leg"
                  checked={legPosition === position}
                  onChange={() => setLegPosition(position)}
                  className="accent-primary"
                />
                {t(`ritten.routeChoice.leg${position}`)}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={isSaving}
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-hover disabled:opacity-50"
        >
          {t("ritten.routeChoice.cancel")}
        </button>
        <button
          type="button"
          onClick={() => void apply()}
          disabled={!selectedId || isSaving || (needsLeg && legPosition === null)}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
        >
          {isSaving ? t("ritten.routeChoice.saving") : t("ritten.routeChoice.confirm")}
        </button>
      </div>
    </RittenDialog>
  );
}

/** The routes as a list of choices: the road only, the chosen one marked. */
function RouteOptions({
  options,
  isLoading,
  hasFailed,
  selectedId,
  onSelect,
}: {
  options: readonly RouteOption[];
  isLoading: boolean;
  hasFailed: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useTranslation();

  if (isLoading) {
    return <p className="mt-3 text-sm text-secondary">{t("ritten.routeChoice.loading")}</p>;
  }

  if (hasFailed) {
    return (
      <p role="alert" className="mt-3 text-sm text-danger">
        {t("ritten.routeChoice.loadFailed")}
      </p>
    );
  }

  if (options.length === 0) {
    return <p className="mt-3 text-sm text-muted">{t("ritten.routeChoice.noResults")}</p>;
  }

  return (
    <ul role="radiogroup" aria-label={t("ritten.routeChoice.title")} className="mt-3 max-h-72 overflow-y-auto rounded-md border border-border">
      {options.map((option) => (
        <li key={option.id} className="border-b border-border last:border-0">
          <label
            className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-hover ${
              selectedId === option.id ? "bg-primary/10 font-medium" : ""
            }`}
          >
            <input
              type="radio"
              name="route-choice"
              checked={selectedId === option.id}
              onChange={() => onSelect(option.id)}
              className="accent-primary"
            />
            {option.label}
          </label>
        </li>
      ))}
    </ul>
  );
}
