"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { RittenPagination } from "@/components/ritten/ritten-pagination";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { VehicleFormDialog } from "@/components/vehicles/vehicle-form-dialog";
import { useAsync } from "@/hooks/use-async";
import { useDebounced } from "@/hooks/use-debounced";
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
import { cn } from "@/lib/cn";

/**
 * The fleet.
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

type StatusFilter = "" | "active" | "inactive";

const STATUS_CHOICES: readonly {
  value: StatusFilter;
  labelKey: TranslationKey;
}[] = [
  { value: "", labelKey: "vehicles.filter.statusAll" },
  { value: "active", labelKey: "vehicles.filter.statusActive" },
  { value: "inactive", labelKey: "vehicles.filter.statusInactive" },
];

/**
 * The vehicle was created; only the driver link failed.
 *
 * A distinct type so the page can say exactly that, instead of reporting a
 * failure for an operation that half succeeded.
 */
class VehicleCreatedWithoutDriverError extends Error {}

interface Feedback {
  readonly messageKey: TranslationKey;
  readonly detail?: string;
  readonly isError: boolean;
}

export default function VehiclesPage() {
  const t = useTranslation();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [busyVehicleId, setBusyVehicleId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const debouncedSearch = useDebounced(search, SEARCH_DEBOUNCE_MS);

  const query = useMemo(
    () => ({
      search: debouncedSearch.trim() === "" ? undefined : debouncedSearch.trim(),
      isActive: status === "" ? undefined : status === "active",
    }),
    [debouncedSearch, status],
  );

  useEffect(() => {
    setPage(1);
  }, [query]);

  const vehicles = useAsync(
    useCallback(
      (signal: AbortSignal) =>
        listVehicles({ ...query, page, pageSize: PAGE_SIZE }, signal),
      [query, page],
    ),
    [query, page],
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
      setFeedback({ messageKey: successKey, isError: false });
    } catch (error: unknown) {
      // The vehicle exists in this case, so the list must still be refreshed.
      if (error instanceof VehicleCreatedWithoutDriverError) {
        vehicles.reload();
      }

      setFeedback({
        messageKey:
          error instanceof VehicleCreatedWithoutDriverError
            ? "vehicles.feedback.driverLinkFailed"
            : "vehicles.feedback.failed",
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
    <div className="mx-auto max-w-[1400px] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">
          {t("vehicles.title")}
        </h1>

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

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <div className="min-w-64 flex-1">
          <label
            htmlFor="vehicle-search"
            className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted"
          >
            {t("vehicles.search.label")}
          </label>
          <input
            id="vehicle-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("vehicles.search.placeholder")}
            className="w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground placeholder:text-muted"
          />
        </div>

        <div
          role="radiogroup"
          aria-label={t("vehicles.filter.status")}
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
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full min-w-[900px] text-left text-sm">
                <caption className="sr-only">{t("vehicles.title")}</caption>
                <thead className="border-b border-border bg-hover/50 text-xs uppercase tracking-wide text-muted">
                  <tr>
                    {[
                      "vehicles.column.licensePlate",
                      "vehicles.column.description",
                      "vehicles.column.brand",
                      "vehicles.column.model",
                      "vehicles.column.year",
                      "vehicles.column.status",
                      "vehicles.column.actions",
                    ].map((key) => (
                      <th
                        key={key}
                        scope="col"
                        className="whitespace-nowrap px-3 py-2 font-medium"
                      >
                        {t(key as TranslationKey)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {vehicles.data.items.map((vehicle) => (
                    <VehicleRow
                      key={vehicle.id}
                      vehicle={vehicle}
                      isBusy={busyVehicleId === vehicle.id}
                      onEdit={() => {
                        setEditing(vehicle);
                        setIsCreating(false);
                      }}
                      onToggleActivation={() => toggleActivation(vehicle)}
                    />
                  ))}
                </tbody>
              </table>
            </div>

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
    </div>
  );
}

function VehicleRow({
  vehicle,
  isBusy,
  onEdit,
  onToggleActivation,
}: {
  vehicle: Vehicle;
  isBusy: boolean;
  onEdit: () => void;
  onToggleActivation: () => void;
}) {
  const t = useTranslation();
  const empty = t("vehicles.value.empty");

  return (
    <tr className="border-b border-border last:border-0 hover:bg-hover">
      <td className="px-3 py-2">
        <span className="flex items-center gap-2">
          {/* The vehicle's own colour, as data rather than a token. */}
          <span
            aria-hidden="true"
            style={{ backgroundColor: vehicle.displayColor }}
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
          />
          <Link
            href={`/vehicles/${vehicle.id}`}
            className="font-medium text-primary hover:underline"
          >
            {vehicle.licensePlate}
          </Link>
        </span>
      </td>
      <td className="px-3 py-2 text-secondary">{vehicle.description ?? empty}</td>
      <td className="px-3 py-2 text-secondary">{vehicle.brand ?? empty}</td>
      <td className="px-3 py-2 text-secondary">{vehicle.model ?? empty}</td>
      <td className="px-3 py-2 tabular-nums text-secondary">
        {vehicle.year ?? empty}
      </td>
      <td className="px-3 py-2">
        <Badge tone={vehicle.isActive ? "success" : "neutral"}>
          {vehicle.isActive
            ? t("vehicles.status.active")
            : t("vehicles.status.inactive")}
        </Badge>
      </td>
      <td className="px-3 py-2">
        <span className="flex items-center gap-3">
          <button
            type="button"
            onClick={onEdit}
            disabled={isBusy}
            className="text-sm font-medium text-primary hover:underline disabled:opacity-50"
          >
            {t("vehicles.action.edit")}
          </button>
          <button
            type="button"
            onClick={onToggleActivation}
            disabled={isBusy}
            className={cn(
              "text-sm font-medium disabled:opacity-50",
              vehicle.isActive
                ? "text-danger hover:underline"
                : "text-primary hover:underline",
            )}
          >
            {vehicle.isActive
              ? t("vehicles.action.deactivate")
              : t("vehicles.action.activate")}
          </button>
        </span>
      </td>
    </tr>
  );
}
