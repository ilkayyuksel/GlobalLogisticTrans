"use client";

import { useCallback, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { useAsync } from "@/hooks/use-async";
import {
  applyPricingBootstrap,
  getPricingBootstrapPlan,
  saveSetting,
  type PricingSettingStatus,
} from "@/lib/api/settings";
import { useTranslation } from "@/lib/i18n/language-provider";

/**
 * Every setting the Pricing Engine reads, and whether it exists.
 *
 * ── THE STATE THIS EXISTS FOR ───────────────────────────────────────────────
 * A fresh deployment has no pricing settings at all. The Engine then refuses
 * every calculation, no snapshot is written, and the Ritten pricing screen is
 * empty — with nothing an operator could do about it, because the interface
 * could only edit settings that already existed. This section is what makes
 * that recoverable without SQL.
 *
 * ── IT SHOWS BEFORE IT WRITES ───────────────────────────────────────────────
 * The list is a report first. What is configured, what is missing, and what
 * each missing one would be created with — read from the backend, which is the
 * only thing that knows. Nothing is written until the operator asks.
 *
 * ── AND NOTHING HERE CALCULATES ─────────────────────────────────────────────
 * No value is derived, converted or defaulted in the browser. Every proposed
 * value comes from the backend catalog, and every value is sent as typed.
 * ────────────────────────────────────────────────────────────────────────────
 */
export function PricingConfigurationSection({
  onSaved,
  onFailed,
}: {
  onSaved: () => void;
  onFailed: (error: unknown) => void;
}) {
  const t = useTranslation();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const plan = useAsync(
    useCallback((signal: AbortSignal) => getPricingBootstrapPlan(signal), []),
    [],
  );

  async function run(key: string, operation: () => Promise<unknown>) {
    setBusyKey(key);

    try {
      await operation();
      plan.reload();
      onSaved();
    } catch (error: unknown) {
      onFailed(error);
    } finally {
      setBusyKey(null);
    }
  }

  const missingCount = plan.data?.missingCount ?? 0;
  const creatableCount = plan.data?.creatableCount ?? 0;

  return (
    <section className="rounded-md border border-border bg-card p-4">
      <h2 className="text-sm font-semibold text-foreground">
        {t("settings.pricing.configuration.title")}
      </h2>
      <p className="mt-1 text-[11px] text-muted">
        {t("settings.pricing.configuration.intro")}
      </p>

      {plan.isLoading ? (
        <LoadingState label={t("settings.pricing.loading")} />
      ) : null}

      {!plan.isLoading && plan.error ? (
        <ErrorState error={plan.error} onRetry={plan.reload} />
      ) : null}

      {!plan.isLoading && !plan.error && plan.data ? (
        <>
          {missingCount > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-warning/30 bg-warning/5 px-3 py-2">
              <p role="status" className="text-sm text-foreground">
                {`${missingCount} ${t("settings.pricing.configuration.missingCount")}`}
              </p>
              {/*
                Offered only when the backend says something CAN be created.
                A configuration blocked on a missing Custom Property is not
                fixable from here, and a button that could only fail would be
                worse than none.
              */}
              {creatableCount > 0 ? (
                <button
                  type="button"
                  disabled={busyKey !== null}
                  onClick={() =>
                    void run("bootstrap", () => applyPricingBootstrap())
                  }
                  className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
                >
                  {busyKey === "bootstrap"
                    ? t("settings.pricing.saving")
                    : t("settings.pricing.configuration.createMissing")}
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <caption className="sr-only">
                {t("settings.pricing.configuration.title")}
              </caption>
              <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t("settings.pricing.configuration.setting")}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t("settings.pricing.configuration.status")}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t("settings.pricing.configuration.value")}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t("settings.pricing.routes.actions")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {plan.data.settings.map((setting) => (
                  <SettingRow
                    key={setting.key}
                    setting={setting}
                    isBusy={busyKey === setting.key}
                    isDisabled={busyKey !== null}
                    onSave={(value) =>
                      void run(setting.key, () =>
                        saveSetting("PRICING", setting.key, value),
                      )
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}

/**
 * One setting, editable whether or not it exists yet.
 *
 * The input starts from the configured value, falling back to what the backend
 * PROPOSES for a missing one — so saving an untouched row creates exactly what
 * the plan said it would, and the operator can change it first.
 */
function SettingRow({
  setting,
  isBusy,
  isDisabled,
  onSave,
}: {
  setting: PricingSettingStatus;
  isBusy: boolean;
  isDisabled: boolean;
  onSave: (value: string) => void;
}) {
  const t = useTranslation();
  const [draft, setDraft] = useState<string | null>(null);

  const value = draft ?? setting.value ?? setting.proposedValue ?? "";

  return (
    <tr className="border-b border-border last:border-0 align-top">
      <td className="px-3 py-2 font-mono text-xs text-foreground">
        {setting.key}
        {setting.blockedReason ? (
          <p className="mt-1 max-w-[420px] font-sans text-[11px] text-muted">
            {setting.blockedReason}
          </p>
        ) : null}
      </td>
      <td className="px-3 py-2">
        <Badge tone={isUsable(setting) ? "outline" : "warning"}>
          {t(statusKey(setting))}
        </Badge>
      </td>
      <td className="px-3 py-2">
        <input
          type="text"
          aria-label={setting.key}
          value={value}
          onChange={(event) => setDraft(event.target.value)}
          className="w-56 rounded-md border border-border bg-card px-2 py-1 text-sm text-foreground"
        />
      </td>
      <td className="px-3 py-2">
        <button
          type="button"
          disabled={isDisabled || value.trim() === ""}
          onClick={() => onSave(value.trim())}
          className="rounded-md border border-border px-2 py-0.5 text-xs font-medium text-foreground hover:bg-hover disabled:opacity-50"
        >
          {isBusy ? t("settings.pricing.saving") : t("settings.pricing.save")}
        </button>
      </td>
    </tr>
  );
}

/**
 * Configured, missing, or present but switched off.
 *
 * Inactive is called out rather than folded into "configured": the Engine
 * treats a switched-off setting exactly as a missing one and refuses to price,
 * so a row that looks configured but is not would be the most misleading state
 * this table could show.
 */
function statusKey(setting: PricingSettingStatus) {
  if (!setting.isConfigured) {
    return "settings.pricing.configuration.missing" as const;
  }

  return setting.isActive
    ? ("settings.pricing.configuration.configured" as const)
    : ("settings.pricing.configuration.inactive" as const);
}

/** Whether the Pricing Engine can actually read this setting. */
function isUsable(setting: PricingSettingStatus): boolean {
  return setting.isConfigured && setting.isActive;
}
