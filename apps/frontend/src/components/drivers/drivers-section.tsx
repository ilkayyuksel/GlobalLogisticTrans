"use client";

import { useCallback, useMemo, useState } from "react";

import { DriverFormDialog } from "@/components/drivers/driver-form-dialog";
import { DriversTable } from "@/components/drivers/drivers-table";
import { FleetFeedback, type FleetFeedbackMessage } from "@/components/fleet/fleet-feedback";
import {
  FleetListFilters,
  STATUS_FILTER_VALUES,
  type StatusFilter,
} from "@/components/fleet/fleet-list-filters";
import { RittenPagination } from "@/components/ritten/ritten-pagination";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useAsync } from "@/hooks/use-async";
import { useDebounced } from "@/hooks/use-debounced";
import { useResetOnChange } from "@/hooks/use-reset-on-change";
import { useUrlState } from "@/hooks/use-url-state";
import { choiceParam, pageParam, textParam } from "@/lib/navigation/url-state-codecs";
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

/**
 * The people who drive — section B of the fleet page.
 *
 * Search and filter belong to `GET /drivers`, paging is the backend's, and
 * there is no hard delete: a Driver is deactivated, which keeps every Trip they
 * ever drove resolvable. Which truck someone drives is the links section's.
 *
 * Its list state lives in the address under `driver*` names, because the
 * vehicle list on the same page already uses `search`, `status` and `page`.
 */

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

const SEARCH_PARAM = textParam("driverSearch");
const STATUS_PARAM = choiceParam<StatusFilter>("driverStatus", STATUS_FILTER_VALUES, "");
const PAGE_PARAM = pageParam("driverPage");

export function DriversSection({
  version,
  onChanged,
}: {
  /** Bumped by the page when another section changed a driver's truck. */
  version: number;
  onChanged: () => void;
}) {
  const t = useTranslation();

  const [search, setSearch] = useUrlState(SEARCH_PARAM);
  const [status, setStatus] = useUrlState(STATUS_PARAM);
  const [page, setPage] = useUrlState(PAGE_PARAM);
  const [editing, setEditing] = useState<Driver | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [busyDriverId, setBusyDriverId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FleetFeedbackMessage | null>(null);

  const debouncedSearch = useDebounced(search, SEARCH_DEBOUNCE_MS);

  const query = useMemo(
    () => ({
      search: debouncedSearch.trim() === "" ? undefined : debouncedSearch.trim(),
      isActive: status === "" ? undefined : status === "active",
    }),
    [debouncedSearch, status],
  );

  // A narrowed list has fewer pages; staying on page 4 would show nothing.
  useResetOnChange(query, () => setPage(1));

  const drivers = useAsync(
    useCallback(
      (signal: AbortSignal) =>
        listDrivers({ ...query, page, pageSize: PAGE_SIZE }, signal),
      [query, page],
    ),
    // `version` refetches after a link changed somebody's truck.
    [query, page, version],
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
      onChanged();
      setFeedback({ text: t(successKey), isError: false });
    } catch (error: unknown) {
      setFeedback({
        text: t("drivers.feedback.failed"),
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
      ? runMutation(editing.id, () => updateDriver(editing.id, payload), "drivers.feedback.updated")
      : runMutation(null, () => createDriver(payload), "drivers.feedback.created");
  }

  /** Taking somebody out of the planning is confirmed; putting them back is not. */
  function toggleActivation(driver: Driver): void {
    if (driver.isActive && !window.confirm(t("drivers.confirm.deactivate"))) {
      return;
    }

    void runMutation(
      driver.id,
      () => (driver.isActive ? deactivateDriver(driver.id) : activateDriver(driver.id)),
      driver.isActive ? "drivers.feedback.deactivated" : "drivers.feedback.activated",
    ).catch(() => undefined);
  }

  return (
    <section id="chauffeurs" aria-labelledby="drivers-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="drivers-heading" className="text-lg font-semibold text-foreground">
          {t("drivers.title")}
        </h2>

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

      <FleetListFilters
        idPrefix="driver"
        search={search}
        onSearchChange={setSearch}
        status={status}
        onStatusChange={setStatus}
        labels={{
          search: "drivers.search.label",
          searchPlaceholder: "drivers.search.placeholder",
          status: "drivers.filter.status",
          all: "drivers.filter.statusAll",
          active: "drivers.filter.statusActive",
          inactive: "drivers.filter.statusInactive",
        }}
      />

      <FleetFeedback feedback={feedback} />

      {isFirstLoad ? <LoadingState label={t("drivers.loading")} /> : null}

      {!isFirstLoad && drivers.error ? (
        <ErrorState error={drivers.error} onRetry={drivers.reload} />
      ) : null}

      {!isFirstLoad && !drivers.error && drivers.data ? (
        drivers.data.items.length === 0 ? (
          <EmptyState
            title={isFiltered ? t("drivers.empty.filtered") : t("drivers.empty.title")}
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
    </section>
  );
}
