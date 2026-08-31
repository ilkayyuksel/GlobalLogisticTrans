"use client";

import { useCallback, useState } from "react";

import { PricingConfigurationSection } from "@/components/pricing/pricing-configuration-section";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useAsync } from "@/hooks/use-async";
import { userFacingMessage } from "@/lib/api/client";
import {
  changeRouteConfigurationState,
  createRouteConfiguration,
  listRouteConfigurations,
  updateRouteConfiguration,
  type RouteConfiguration,
  type RouteConfigurationPayload,
} from "@/lib/api/route-configuration";
import {
  FUEL_PERCENTAGE_SETTING,
  listSettings,
  saveSetting,
} from "@/lib/api/settings";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { TranslationKey } from "@/lib/i18n/translations";

/**
 * Settings → Prijzen.
 *
 * ── WHAT AN OPERATOR CONFIGURES HERE ────────────────────────────────────────
 * The two inputs the Pricing Engine reads from configuration: the fuel
 * percentage, and what each route costs. Everything else a price is made of is
 * either a Custom Property (its own settings page) or a fact about the Trip.
 *
 * ── ONE ROW IS ONE ROUTE ────────────────────────────────────────────────────
 * The backend stores a route's Tarief in one table and its Toll and Tunnel in
 * another. None of that is visible here, and that is the point: an operator
 * configuring a route means one thing with three amounts on it. The composition
 * is the backend's, so this page can never leave a route half configured.
 *
 * ── NOTHING HERE CALCULATES ─────────────────────────────────────────────────
 * No price is derived, summed or converted in the browser. Amounts are sent as
 * typed and displayed as the backend formatted them.
 *
 * ── AND NOTHING HERE TOUCHES HISTORY ────────────────────────────────────────
 * Changing configuration affects the NEXT calculation. A Trip already closed
 * keeps the amounts it was priced with, including the fuel percentage that
 * applied on the day — the page says so, because an operator changing a rate
 * deserves to know it will not rewrite last month's invoices.
 * ────────────────────────────────────────────────────────────────────────────
 */

interface Feedback {
  readonly messageKey: TranslationKey;
  readonly detail?: string;
  readonly isError: boolean;
}

/** A route being edited, or the blank one being added. */
interface RouteDraft {
  readonly id: string | null;
  departure: string;
  destination: string;
  tarief: string;
  toll: string;
  tunnel: string;
}

const BLANK_DRAFT: RouteDraft = {
  id: null,
  departure: "",
  destination: "",
  tarief: "",
  toll: "",
  tunnel: "",
};

export default function PricingSettingsPage() {
  const t = useTranslation();
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const settings = useAsync(
    useCallback((signal: AbortSignal) => listSettings(signal), []),
    [],
  );
  const routes = useAsync(
    useCallback((signal: AbortSignal) => listRouteConfigurations(signal), []),
    [],
  );

  return (
    <div className="mx-auto max-w-[1200px] space-y-6">
      <h1 className="text-xl font-semibold text-foreground">
        {t("settings.pricing.title")}
      </h1>

      {feedback ? (
        <p
          role="status"
          className={`rounded-md border px-4 py-2 text-sm ${
            feedback.isError
              ? "border-danger/30 bg-danger/5 text-foreground"
              : "border-success/30 bg-success/5 text-foreground"
          }`}
        >
          {t(feedback.messageKey)}
          {feedback.detail ? ` ${feedback.detail}` : null}
        </p>
      ) : null}

      <FuelSection
        settings={settings}
        onSaved={() => {
          settings.reload();
          setFeedback({ messageKey: "settings.pricing.saved", isError: false });
        }}
        onFailed={(error) =>
          setFeedback({
            messageKey: "settings.pricing.failed",
            detail: userFacingMessage(error),
            isError: true,
          })
        }
      />

      {/*
        Below the fuel control, which stays the shortcut for the number that
        changes most often. This is the complete picture: every setting the
        Engine reads, including the ones that have no row yet.
      */}
      <PricingConfigurationSection
        onSaved={() => {
          settings.reload();
          setFeedback({ messageKey: "settings.pricing.saved", isError: false });
        }}
        onFailed={(error) =>
          setFeedback({
            messageKey: "settings.pricing.failed",
            detail: userFacingMessage(error),
            isError: true,
          })
        }
      />

      <RouteSection
        routes={routes}
        onSaved={() => {
          routes.reload();
          setFeedback({ messageKey: "settings.pricing.saved", isError: false });
        }}
        onFailed={(error) =>
          setFeedback({
            messageKey: "settings.pricing.failed",
            detail: userFacingMessage(error),
            isError: true,
          })
        }
      />
    </div>
  );
}

/**
 * Brandstofpercentage.
 *
 * One number, saved on its own. It is a PERCENTAGE and is labelled as one, so
 * nobody types 0.15 meaning fifteen percent.
 */
function FuelSection({
  settings,
  onSaved,
  onFailed,
}: {
  settings: ReturnType<typeof useAsync<Awaited<ReturnType<typeof listSettings>>>>;
  onSaved: () => void;
  onFailed: (error: unknown) => void;
}) {
  const t = useTranslation();
  const [draft, setDraft] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const stored =
    settings.data?.find(
      (setting) =>
        setting.category === FUEL_PERCENTAGE_SETTING.category &&
        setting.key === FUEL_PERCENTAGE_SETTING.key,
    )?.value ?? "";

  const value = draft ?? stored;

  async function save(): Promise<void> {
    setIsSaving(true);

    try {
      /*
       * Saves whether or not the setting has ever existed. It used to be an
       * update, which meant this control silently failed on every fresh
       * deployment — where FUEL_PERCENTAGE has no row at all.
       */
      await saveSetting(
        FUEL_PERCENTAGE_SETTING.category,
        FUEL_PERCENTAGE_SETTING.key,
        value.trim(),
      );
      setDraft(null);
      onSaved();
    } catch (error: unknown) {
      onFailed(error);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="rounded-md border border-border bg-card p-4">
      <h2 className="text-sm font-semibold text-foreground">
        {t("settings.pricing.fuel.title")}
      </h2>
      {/*
        Said before the change rather than after it: an operator moving a rate
        needs to know what it will and will not touch.
      */}
      <p className="mt-1 text-[11px] text-muted">
        {t("settings.pricing.fuel.historyNote")}
      </p>

      {settings.isLoading ? (
        <LoadingState label={t("settings.pricing.loading")} />
      ) : null}

      {!settings.isLoading && settings.error ? (
        <ErrorState error={settings.error} onRetry={settings.reload} />
      ) : null}

      {!settings.isLoading && !settings.error ? (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label
              htmlFor="fuel-percentage"
              className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted"
            >
              {t("settings.pricing.fuel.label")}
            </label>
            <div className="flex items-center gap-2">
              <input
                id="fuel-percentage"
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step="0.01"
                value={value}
                onChange={(event) => setDraft(event.target.value)}
                className="w-28 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
              />
              <span aria-hidden="true" className="text-sm text-secondary">
                %
              </span>
            </div>
          </div>

          <button
            type="button"
            disabled={isSaving || value.trim() === ""}
            onClick={() => void save()}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
          >
            {isSaving ? t("settings.pricing.saving") : t("settings.pricing.save")}
          </button>
        </div>
      ) : null}
    </section>
  );
}

/** Routeprijzen — one row per route, three amounts on it. */
function RouteSection({
  routes,
  onSaved,
  onFailed,
}: {
  routes: ReturnType<
    typeof useAsync<Awaited<ReturnType<typeof listRouteConfigurations>>>
  >;
  onSaved: () => void;
  onFailed: (error: unknown) => void;
}) {
  const t = useTranslation();
  const [draft, setDraft] = useState<RouteDraft | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function run(id: string | null, operation: () => Promise<unknown>) {
    setBusyId(id ?? "new");

    try {
      await operation();
      setDraft(null);
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

    // Sent as typed. The backend validates the range and the decimals; a check
    // repeated here would be the same rule in two places.
    const payload: RouteConfigurationPayload = {
      departure: draft.departure.trim(),
      destination: draft.destination.trim(),
      tarief: Number(draft.tarief),
      toll: Number(draft.toll),
      tunnel: Number(draft.tunnel),
    };

    void run(draft.id, () =>
      draft.id === null
        ? createRouteConfiguration(payload)
        : updateRouteConfiguration(draft.id, payload),
    );
  }

  return (
    <section className="rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          {t("settings.pricing.routes.title")}
        </h2>
        <button
          type="button"
          onClick={() => setDraft({ ...BLANK_DRAFT })}
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-hover"
        >
          {t("settings.pricing.routes.add")}
        </button>
      </div>
      {/*
        Direction is part of the identity, and an operator cannot see that from
        a table of rows. Saying it once here is cheaper than a support call
        about a route that "already exists".
      */}
      <p className="mt-1 text-[11px] text-muted">
        {t("settings.pricing.routes.directionNote")}
      </p>

      {routes.isLoading ? (
        <LoadingState label={t("settings.pricing.loading")} />
      ) : null}

      {!routes.isLoading && routes.error ? (
        <ErrorState error={routes.error} onRetry={routes.reload} />
      ) : null}

      {!routes.isLoading && !routes.error ? (
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
                  {t("settings.pricing.routes.toll")}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {t("settings.pricing.routes.tunnel")}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t("settings.pricing.routes.active")}
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

              {(routes.data ?? []).map((route) =>
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
                    onEdit={() =>
                      setDraft({
                        id: route.id,
                        departure: route.departure,
                        destination: route.destination,
                        tarief: route.tarief,
                        toll: route.toll,
                        tunnel: route.tunnel,
                      })
                    }
                    onToggleActive={() =>
                      void run(route.id, () =>
                        changeRouteConfigurationState(route.id, !route.isActive),
                      )
                    }
                  />
                ),
              )}
            </tbody>
          </table>

          {(routes.data ?? []).length === 0 && !draft ? (
            <EmptyState
              title={t("settings.pricing.routes.empty")}
              description={t("settings.pricing.routes.emptyDescription")}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function RouteRow({
  route,
  isBusy,
  onEdit,
  onToggleActive,
}: {
  route: RouteConfiguration;
  isBusy: boolean;
  onEdit: () => void;
  onToggleActive: () => void;
}) {
  const t = useTranslation();

  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-3 py-2 text-foreground">{route.departure}</td>
      <td className="px-3 py-2 text-foreground">{route.destination}</td>
      <td className="px-3 py-2 text-right tabular-nums text-secondary">
        {route.tarief}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-secondary">
        {route.toll}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-secondary">
        {route.tunnel}
      </td>
      <td className="px-3 py-2">
        <Badge tone="outline">
          {t(
            route.isActive
              ? "settings.pricing.routes.isActive"
              : "settings.pricing.routes.isInactive",
          )}
        </Badge>
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
            onClick={onToggleActive}
            aria-label={`${t(
              route.isActive
                ? "settings.pricing.routes.deactivate"
                : "settings.pricing.routes.activate",
            )} ${route.departure} ${route.destination}`}
            className="rounded-md border border-border px-2 py-0.5 text-xs font-medium text-secondary hover:bg-hover hover:text-foreground disabled:opacity-50"
          >
            {t(
              route.isActive
                ? "settings.pricing.routes.deactivate"
                : "settings.pricing.routes.activate",
            )}
          </button>
        </span>
      </td>
    </tr>
  );
}

/**
 * The add / edit row.
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
    field: "tarief" | "toll" | "tunnel",
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
      {amountInput("toll", "settings.pricing.routes.toll")}
      {amountInput("tunnel", "settings.pricing.routes.tunnel")}
      <td className="px-3 py-2" />
      <td className="px-3 py-2">
        <span className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={isBusy}
            onClick={onSave}
            className="rounded-md bg-primary px-2 py-0.5 text-xs font-medium text-white hover:bg-primary-hover disabled:opacity-50"
          >
            {isBusy
              ? t("settings.pricing.saving")
              : t("settings.pricing.save")}
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
