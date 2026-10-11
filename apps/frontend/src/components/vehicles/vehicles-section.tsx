"use client";

import { useCallback, useMemo, useState } from "react";

import { FleetFeedback, type FleetFeedbackMessage } from "@/components/fleet/fleet-feedback";
import {
  FleetListFilters,
  STATUS_FILTER_VALUES,
  type StatusFilter,
} from "@/components/fleet/fleet-list-filters";
import { RittenPagination } from "@/components/ritten/ritten-pagination";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { VehicleFormDialog } from "@/components/vehicles/vehicle-form-dialog";
import { VehiclesTable } from "@/components/vehicles/vehicles-table";
import { useAsync } from "@/hooks/use-async";
import { useDebounced } from "@/hooks/use-debounced";
import { useResetOnChange } from "@/hooks/use-reset-on-change";
import { useUrlState } from "@/hooks/use-url-state";
import { choiceParam, pageParam, textParam } from "@/lib/navigation/url-state-codecs";
import { userFacingMessage } from "@/lib/api/client";
import type { Vehicle } from "@/lib/api/types";
import {
  activateVehicle,
  createAssignment,
  createVehicle,
  deactivateVehicle,
  listVehicles,
  updateVehicle,
  type CreateVehiclePayload,
} from "@/lib/api/vehicles";
import { listDrivers } from "@/lib/api/drivers";
import { today } from "@/lib/calendar/calendar-dates";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { TranslationKey } from "@/lib/i18n/translations";

/**
 * The fleet — section C of the fleet page.
 *
 * Searching and filtering are the BACKEND's: `GET /vehicles` accepts both, and
 * narrowing the loaded page in the browser would look like a working filter
 * while ignoring everything past it.
 *
 * There is no Type column and no Type filter. The Vehicle model has no such
 * column — `description` is free text, not a category — so a type control would
 * be a filter over data that does not exist. Reported rather than invented.
 *
 * There is no delete either: the backend offers deactivation, which is the
 * right model. An inactive Vehicle keeps every Trip and every maintenance
 * record that refers to it.
 */

const PAGE_SIZE = 25;
/** Every active driver fits in one page for a fleet of this size. */
const DRIVER_PICKER_PAGE_SIZE = 200;
const SEARCH_DEBOUNCE_MS = 300;

/**
 * The vehicle was created; only the driver link failed.
 *
 * A distinct type so the page can say exactly that, instead of reporting a
 * failure for an operation that half succeeded.
 */
class VehicleCreatedWithoutDriverError extends Error {}

/**
 * The list's search, filter and page, kept in the address so Back from a
 * record returns to the same list — see `useUrlState`.
 */
const SEARCH_PARAM = textParam("search");
const STATUS_PARAM = choiceParam<StatusFilter>("status", STATUS_FILTER_VALUES, "");
const PAGE_PARAM = pageParam();

export function VehiclesSection({
  version,
  onChanged,
}: {
  /** Bumped by the page when another section changed a vehicle's driver. */
  version: number;
  onChanged: () => void;
}) {
  const t = useTranslation();

  const [search, setSearch] = useUrlState(SEARCH_PARAM);
  const [status, setStatus] = useUrlState(STATUS_PARAM);
  const [page, setPage] = useUrlState(PAGE_PARAM);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [busyVehicleId, setBusyVehicleId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FleetFeedbackMessage | null>(null);

  const debouncedSearch = useDebounced(search, SEARCH_DEBOUNCE_MS);

  const query = useMemo(
    () => ({
      search: debouncedSearch.trim() === "" ? undefined : debouncedSearch.trim(),
      isActive: status === "" ? undefined : status === "active",
    }),
    [debouncedSearch, status],
  );

  // Not on mount: a list returned to with Back keeps the page it was left on.
  useResetOnChange(query, () => setPage(1));

  const vehicles = useAsync(
    useCallback(
      (signal: AbortSignal) =>
        listVehicles({ ...query, page, pageSize: PAGE_SIZE }, signal),
      [query, page],
    ),
    // `version` refetches after a link changed somebody's truck.
    [query, page, version],
  );

  /**
   * The drivers a new vehicle can be assigned to.
   *
   * Fetched once for the page rather than when the dialog opens: the fleet of a
   * family business is one small list, and asking again on every open would be
   * a request per click for data that does not change between them.
   */
  const drivers = useAsync(
    useCallback(
      (signal: AbortSignal) =>
        listDrivers({ isActive: true, pageSize: DRIVER_PICKER_PAGE_SIZE }, signal),
      [],
    ),
    [],
  );

  const isFiltered = query.search !== undefined || query.isActive !== undefined;
  const isFirstLoad = vehicles.isLoading && !vehicles.data;

  /** One call, then the authoritative data, then the report. */
  async function runMutation(
    vehicleId: string | null,
    operation: () => Promise<unknown>,
    successKey: TranslationKey,
  ): Promise<void> {
    setBusyVehicleId(vehicleId);
    setFeedback(null);

    try {
      await operation();

      vehicles.reload();
      onChanged();
      setFeedback({ text: t(successKey), isError: false });
    } catch (error: unknown) {
      // The vehicle exists in this case, so the list must still be refreshed.
      if (error instanceof VehicleCreatedWithoutDriverError) {
        vehicles.reload();
        onChanged();
      }

      setFeedback({
        text: t(
          error instanceof VehicleCreatedWithoutDriverError
            ? "vehicles.feedback.driverLinkFailed"
            : "vehicles.feedback.failed",
        ),
        detail: userFacingMessage(error),
        isError: true,
      });

      // Rethrown so the form keeps its values and shows the field-level detail.
      throw error;
    } finally {
      setBusyVehicleId(null);
    }
  }

  function save(
    payload: CreateVehiclePayload,
    driverId: string | null,
  ): Promise<void> {
    if (editing) {
      return runMutation(
        editing.id,
        () => updateVehicle(editing.id, payload),
        "vehicles.feedback.updated",
      );
    }

    return runMutation(
      null,
      () => createWithOptionalDriver(payload, driverId),
      "vehicles.feedback.created",
    );
  }

  /**
   * Creates the Vehicle, then — only if a driver was chosen — the assignment.
   *
   * Two calls in sequence because the assignment needs the vehicle's id, and
   * there is no endpoint that creates both. The driver is deliberately NOT
   * written onto the Vehicle: it becomes a VehicleAssignment starting today,
   * through the same API the vehicle page uses, so there is one way to link a
   * driver to a truck rather than two.
   *
   * A failed assignment does not undo the vehicle. The truck exists and is
   * correct; what is missing is a link the operator can add on its own page,
   * and reporting that is more honest than pretending the whole thing failed.
   */
  async function createWithOptionalDriver(
    payload: CreateVehiclePayload,
    driverId: string | null,
  ): Promise<void> {
    const created = await createVehicle(payload);

    if (!driverId) {
      return;
    }

    try {
      await createAssignment({
        vehicleId: created.id,
        driverId,
        validFrom: today(),
      });
    } catch (error: unknown) {
      throw new VehicleCreatedWithoutDriverError(userFacingMessage(error));
    }
  }

  function toggleActivation(vehicle: Vehicle): void {
    if (
      vehicle.isActive &&
      !window.confirm(t("vehicles.confirm.deactivate"))
    ) {
      return;
    }

    void runMutation(
      vehicle.id,
      () =>
        vehicle.isActive
          ? deactivateVehicle(vehicle.id)
          : activateVehicle(vehicle.id),
      vehicle.isActive
        ? "vehicles.feedback.deactivated"
        : "vehicles.feedback.activated",
    ).catch(() => undefined);
  }

  return (
    <section id="wagens" aria-labelledby="vehicles-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="vehicles-heading" className="text-lg font-semibold text-foreground">
          {t("vehicles.title")}
        </h2>

        <button
          type="button"
          onClick={() => {
            setEditing(null);
            setIsCreating(true);
          }}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover"
        >
          + {t("vehicles.action.new")}
        </button>
      </div>

      <FleetListFilters
        idPrefix="vehicle"
        search={search}
        onSearchChange={setSearch}
        status={status}
        onStatusChange={setStatus}
        labels={{
          search: "vehicles.search.label",
          searchPlaceholder: "vehicles.search.placeholder",
          status: "vehicles.filter.status",
          all: "vehicles.filter.statusAll",
          active: "vehicles.filter.statusActive",
          inactive: "vehicles.filter.statusInactive",
        }}
      />

      <FleetFeedback feedback={feedback} />

      {isFirstLoad ? <LoadingState label={t("vehicles.loading")} /> : null}

      {!isFirstLoad && vehicles.error ? (
        <ErrorState error={vehicles.error} onRetry={vehicles.reload} />
      ) : null}

      {!isFirstLoad && !vehicles.error && vehicles.data ? (
        vehicles.data.items.length === 0 ? (
          <EmptyState
            title={
              isFiltered
                ? t("vehicles.empty.filtered")
                : t("vehicles.empty.title")
            }
            description={t("vehicles.empty.description")}
          />
        ) : (
          <>
            <VehiclesTable
              vehicles={vehicles.data.items}
              busyVehicleId={busyVehicleId}
              onEdit={(vehicle) => {
                setEditing(vehicle);
                setIsCreating(false);
              }}
              onToggleActivation={toggleActivation}
            />

            <RittenPagination meta={vehicles.data.meta} onChange={setPage} />
          </>
        )
      ) : null}

      {isCreating || editing ? (
        <VehicleFormDialog
          vehicle={editing}
          drivers={drivers.data ? drivers.data.items : []}
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
