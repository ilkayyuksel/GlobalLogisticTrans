"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { DriverFormDialog } from "@/components/drivers/driver-form-dialog";
import { DriversTable } from "@/components/drivers/drivers-table";
import { RittenPagination } from "@/components/ritten/ritten-pagination";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useAsync } from "@/hooks/use-async";
import { useDebounced } from "@/hooks/use-debounced";
import { userFacingMessage } from "@/lib/api/client";
import {
  activateDriver,
  createDriver,
  deactivateDriver,
  listDrivers,
  updateDriver,
  type CreateDriverPayload,
} from "@/lib/api/drivers";
import type { Driver } from "@/lib/api/types";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { TranslationKey } from "@/lib/i18n/translations";
import { cn } from "@/lib/cn";

/**
 * The people who drive.
 *
 * The counterpart of the fleet page, and deliberately the same shape: search
 * and filter belong to `GET /drivers`, paging is the backend's, and there is no
 * delete — a Driver is deactivated, which keeps every Trip they ever drove
 * resolvable.
 *
 * ── WHAT THIS PAGE IS NOT ───────────────────────────────────────────────────
 * Not a personnel system. It maintains the fields the Driver model already has
 * so that a driver can be created and corrected somewhere; contracts, licences,
 * hours and leave are not here and are not implied.
 *
 * Which truck someone drives is NOT set here either. That is a VehicleAssignment
 * — it has a date range, and it is what gives a Trip its effective driver — so
 * it is maintained on the vehicle, where the range makes sense.
 * ────────────────────────────────────────────────────────────────────────────
 */

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

type StatusFilter = "" | "active" | "inactive";

const STATUS_CHOICES: readonly {
  value: StatusFilter;
  labelKey: TranslationKey;
}[] = [
  { value: "", labelKey: "drivers.filter.statusAll" },
  { value: "active", labelKey: "drivers.filter.statusActive" },
  { value: "inactive", labelKey: "drivers.filter.statusInactive" },
];

interface Feedback {
  readonly messageKey: TranslationKey;
  readonly detail?: string;
  readonly isError: boolean;
}

export default function DriversPage() {
  const t = useTranslation();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Driver | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [busyDriverId, setBusyDriverId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const debouncedSearch = useDebounced(search, SEARCH_DEBOUNCE_MS);

  const query = useMemo(
    () => ({
      search: debouncedSearch.trim() === "" ? undefined : debouncedSearch.trim(),
      isActive: status === "" ? undefined : status === "active",
    }),
    [debouncedSearch, status],
  );

  // A narrowed list has fewer pages; staying on page 4 would show nothing.
  useEffect(() => {
    setPage(1);
  }, [query]);

  const drivers = useAsync(
    useCallback(
      (signal: AbortSignal) =>
        listDrivers({ ...query, page, pageSize: PAGE_SIZE }, signal),
      [query, page],
    ),
    [query, page],
  );

  const isFiltered = query.search !== undefined || query.isActive !== undefined;
  const isFirstLoad = drivers.isLoading && !drivers.data;

  /** One call, then the authoritative data, then the report. */
  async function runMutation(
    driverId: string | null,
    operation: () => Promise<unknown>,
    successKey: TranslationKey,
  ): Promise<void> {
    setBusyDriverId(driverId);
    setFeedback(null);

    try {
      await operation();

      drivers.reload();
      setFeedback({ messageKey: successKey, isError: false });
    } catch (error: unknown) {
      setFeedback({
        messageKey: "drivers.feedback.failed",
        detail: userFacingMessage(error),
        isError: true,
      });

      // Rethrown so the form keeps its values and shows the field-level detail.
      throw error;
    } finally {
      setBusyDriverId(null);
    }
  }

  function save(payload: CreateDriverPayload): Promise<void> {
    return editing
      ? runMutation(
          editing.id,
          () => updateDriver(editing.id, payload),
          "drivers.feedback.updated",
        )
      : runMutation(
          null,
          () => createDriver(payload),
          "drivers.feedback.created",
        );
  }

  /**
   * Deactivation is confirmed, activation is not.
   *
   * Taking somebody out of the planning is the consequential half; putting them
   * back can simply be undone.
   */
  function toggleActivation(driver: Driver): void {
    if (driver.isActive && !window.confirm(t("drivers.confirm.deactivate"))) {
      return;
    }

    void runMutation(
      driver.id,
      () =>
        driver.isActive ? deactivateDriver(driver.id) : activateDriver(driver.id),
      driver.isActive
        ? "drivers.feedback.deactivated"
        : "drivers.feedback.activated",
    ).catch(() => undefined);
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">
          {t("drivers.title")}
        </h1>

        <button
          type="button"
          onClick={() => {
            setEditing(null);
            setIsCreating(true);
          }}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover"
        >
          + {t("drivers.action.new")}
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <div className="min-w-64 flex-1">
          <label
            htmlFor="driver-search"
            className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted"
          >
            {t("drivers.search.label")}
          </label>
          <input
            id="driver-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("drivers.search.placeholder")}
            className="w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground placeholder:text-muted"
          />
        </div>

        <div
          role="radiogroup"
          aria-label={t("drivers.filter.status")}
          className="inline-flex rounded-md border border-border bg-card p-0.5"
        >
          {STATUS_CHOICES.map((choice) => (
            <button
              key={choice.value === "" ? "all" : choice.value}
              type="button"
              role="radio"
              aria-checked={status === choice.value}
              onClick={() => setStatus(choice.value)}
              className={cn(
                "rounded px-3 py-1.5 text-sm font-medium",
                status === choice.value
                  ? "bg-primary text-white"
                  : "text-secondary hover:bg-hover hover:text-foreground",
              )}
            >
              {t(choice.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {feedback ? (
        <p
          role="status"
          className={cn(
            "rounded-md border px-4 py-2 text-sm",
            feedback.isError
              ? "border-danger/30 bg-danger/5 text-foreground"
              : "border-success/30 bg-success/5 text-foreground",
          )}
        >
          <span className="font-medium">{t(feedback.messageKey)}</span>
          {feedback.detail ? ` — ${feedback.detail}` : ""}
        </p>
      ) : null}

      {isFirstLoad ? <LoadingState label={t("drivers.loading")} /> : null}

      {!isFirstLoad && drivers.error ? (
        <ErrorState error={drivers.error} onRetry={drivers.reload} />
      ) : null}

      {!isFirstLoad && !drivers.error && drivers.data ? (
        drivers.data.items.length === 0 ? (
          <EmptyState
            title={
              isFiltered ? t("drivers.empty.filtered") : t("drivers.empty.title")
            }
            description={t("drivers.empty.description")}
          />
        ) : (
          <>
            <DriversTable
              drivers={drivers.data.items}
              busyDriverId={busyDriverId}
              onEdit={(driver) => {
                setEditing(driver);
                setIsCreating(false);
              }}
              onToggleActivation={toggleActivation}
            />

            <RittenPagination meta={drivers.data.meta} onChange={setPage} />
          </>
        )
      ) : null}

      {isCreating || editing ? (
        <DriverFormDialog
          driver={editing}
          onSave={save}
          onClose={() => {
            setIsCreating(false);
            setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}
