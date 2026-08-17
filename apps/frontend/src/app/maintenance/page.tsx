"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  MAINTENANCE_STATUSES,
  MaintenanceFormDialog,
  statusLabelKey,
} from "@/components/maintenance/maintenance-form-dialog";
import { RittenPagination } from "@/components/ritten/ritten-pagination";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useAsync } from "@/hooks/use-async";
import { useDebounced } from "@/hooks/use-debounced";
import { userFacingMessage } from "@/lib/api/client";
import { listActiveVehicles } from "@/lib/api/fleet";
import {
  createMaintenance,
  listMaintenance,
  updateMaintenance,
  type CreateMaintenancePayload,
  type Maintenance,
  type MaintenanceStatus,
} from "@/lib/api/maintenance";
import { today } from "@/lib/calendar/calendar-dates";
import { maintenanceTypeLabel } from "@/lib/maintenance/maintenance-types";
import { formatCalendarDate } from "@/lib/calendar/calendar-dates";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { TranslationKey } from "@/lib/i18n/translations";
import { cn } from "@/lib/cn";

/**
 * The maintenance history of the fleet.
 *
 * Filtering, searching and paging are the BACKEND's; nothing is narrowed here.
 *
 * There is NO delete, and there never will be: maintenance is history, and work
 * that will not happen is set to CANCELLED — which keeps the record and its
 * reason readable.
 *
 * "Volgend onderhoud" shows the planned date, the planned mileage, or both,
 * exactly as they were entered. Whether a planned MILEAGE has been reached is
 * not shown as due anywhere, because answering that needs a current odometer
 * reading and this system has none.
 */

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

const STATUS_TONES: Record<MaintenanceStatus, BadgeTone> = {
  PLANNED: "info",
  IN_PROGRESS: "warning",
  COMPLETED: "success",
  CANCELLED: "neutral",
};

interface Feedback {
  readonly messageKey: TranslationKey;
  readonly detail?: string;
  readonly isError: boolean;
}

export default function MaintenancePage() {
  const t = useTranslation();

  const [search, setSearch] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [status, setStatus] = useState<MaintenanceStatus | "">("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Maintenance | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const debouncedSearch = useDebounced(search, SEARCH_DEBOUNCE_MS);

  const query = useMemo(
    () => ({
      search: debouncedSearch.trim() === "" ? undefined : debouncedSearch.trim(),
      vehicleId: vehicleId === "" ? undefined : vehicleId,
      status: status === "" ? undefined : status,
    }),
    [debouncedSearch, vehicleId, status],
  );

  useEffect(() => {
    setPage(1);
  }, [query]);

  const records = useAsync(
    useCallback(
      (signal: AbortSignal) =>
        listMaintenance({ ...query, page, pageSize: PAGE_SIZE }, signal),
      [query, page],
    ),
    [query, page],
  );

  /** One request for the whole page — the vehicle filter and the form share it. */
  const vehicles = useAsync(
    useCallback((signal: AbortSignal) => listActiveVehicles(signal), []),
    [],
  );

  const isFiltered = Object.values(query).some((value) => value !== undefined);
  const isFirstLoad = records.isLoading && !records.data;

  async function save(payload: CreateMaintenancePayload): Promise<void> {
    setFeedback(null);

    try {
      if (editing) {
        // The Vehicle is never reassigned, so it is not part of an update.
        const { vehicleId: _unchanged, ...changes } = payload;

        await updateMaintenance(editing.id, changes);
      } else {
        await createMaintenance(payload);
      }

      records.reload();
      setFeedback({
        messageKey: editing
          ? "maintenance.feedback.updated"
          : "maintenance.feedback.created",
        isError: false,
      });
    } catch (error: unknown) {
      setFeedback({
        messageKey: "maintenance.feedback.failed",
        detail: userFacingMessage(error),
        isError: true,
      });

      // Rethrown so the form stays open with its values and the detail.
      throw error;
    }
  }

  return (
    <div className="mx-auto max-w-[1500px] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">
          {t("maintenance.title")}
        </h1>

        <button
          type="button"
          onClick={() => {
            setEditing(null);
            setIsCreating(true);
          }}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover"
        >
          + {t("maintenance.action.new")}
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <div className="min-w-56 flex-1">
          <label
            htmlFor="maintenance-search"
            className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted"
          >
            {t("maintenance.search.label")}
          </label>
          <input
            id="maintenance-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("maintenance.search.placeholder")}
            className="w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground placeholder:text-muted"
          />
        </div>

        <div>
          <label
            htmlFor="maintenance-vehicle-filter"
            className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted"
          >
            {t("maintenance.filter.vehicle")}
          </label>
          <select
            id="maintenance-vehicle-filter"
            value={vehicleId}
            onChange={(event) => setVehicleId(event.target.value)}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
          >
            <option value="">{t("maintenance.filter.vehicleAll")}</option>
            {(vehicles.data?.items ?? []).map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.licensePlate}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="maintenance-status-filter"
            className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted"
          >
            {t("maintenance.filter.status")}
          </label>
          <select
            id="maintenance-status-filter"
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as MaintenanceStatus | "")
            }
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
          >
            <option value="">{t("maintenance.filter.statusAll")}</option>
            {MAINTENANCE_STATUSES.map((value) => (
              <option key={value} value={value}>
                {t(statusLabelKey(value))}
              </option>
            ))}
          </select>
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

      {isFirstLoad ? <LoadingState label={t("maintenance.loading")} /> : null}

      {!isFirstLoad && records.error ? (
        <ErrorState error={records.error} onRetry={records.reload} />
      ) : null}

      {!isFirstLoad && !records.error && records.data ? (
        records.data.items.length === 0 ? (
          <EmptyState
            title={
              isFiltered
                ? t("maintenance.empty.filtered")
                : t("maintenance.empty.title")
            }
            description={t("maintenance.empty.description")}
          />
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full min-w-[1100px] text-left text-sm">
                <caption className="sr-only">{t("maintenance.title")}</caption>
                <thead className="border-b border-border bg-hover/50 text-xs uppercase tracking-wide text-muted">
                  <tr>
                    {[
                      "maintenance.column.date",
                      "maintenance.column.vehicle",
                      "maintenance.column.type",
                      "maintenance.column.status",
                      "maintenance.column.description",
                      "maintenance.column.workshop",
                      "maintenance.column.mileage",
                      "maintenance.column.cost",
                      "maintenance.column.next",
                      "maintenance.column.actions",
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
                  {records.data.items.map((record) => (
                    <MaintenanceRow
                      key={record.id}
                      record={record}
                      onEdit={() => {
                        setEditing(record);
                        setIsCreating(false);
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <RittenPagination meta={records.data.meta} onChange={setPage} />
          </>
        )
      ) : null}

      {isCreating || editing ? (
        <MaintenanceFormDialog
          maintenance={editing}
          vehicles={vehicles.data?.items ?? []}
          today={today()}
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

function MaintenanceRow({
  record,
  onEdit,
}: {
  record: Maintenance;
  onEdit: () => void;
}) {
  const t = useTranslation();
  const empty = t("maintenance.value.empty");

  return (
    <tr className="border-b border-border align-top last:border-0 hover:bg-hover">
      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-secondary">
        {formatCalendarDate(record.maintenanceDate)}
      </td>
      <td className="px-3 py-2">
        {record.vehicle ? (
          <span className="flex items-center gap-2">
            <span
              aria-hidden="true"
              style={{ backgroundColor: record.vehicle.displayColor }}
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
            />
            <span className="whitespace-nowrap text-foreground">
              {record.vehicle.licensePlate}
            </span>
          </span>
        ) : (
          empty
        )}
      </td>
      <td className="px-3 py-2 text-secondary">
        {maintenanceTypeLabel(record.maintenanceType, t) ?? empty}
      </td>
      <td className="px-3 py-2">
        <Badge tone={STATUS_TONES[record.status]}>
          {t(statusLabelKey(record.status))}
        </Badge>
      </td>
      <td className="px-3 py-2 text-secondary">{record.description}</td>
      <td className="px-3 py-2 text-secondary">{record.workshop ?? empty}</td>
      <td className="px-3 py-2 tabular-nums text-secondary">
        {record.mileage === null
          ? empty
          : `${formatMileage(record.mileage)} ${t("maintenance.value.km")}`}
      </td>
      {/* Displayed exactly as the backend formatted it; never re-derived. */}
      <td className="px-3 py-2 tabular-nums text-secondary">
        {record.cost ?? empty}
      </td>
      <td className="px-3 py-2 tabular-nums text-secondary">
        <NextMaintenance record={record} />
      </td>
      <td className="px-3 py-2">
        <button
          type="button"
          onClick={onEdit}
          className="text-sm font-medium text-primary hover:underline"
        >
          {t("maintenance.action.edit")}
        </button>
      </td>
    </tr>
  );
}

/** Date, mileage, or both — whichever the Administrator entered. */
function NextMaintenance({ record }: { record: Maintenance }) {
  const t = useTranslation();

  if (record.nextMaintenanceDate === null && record.nextMaintenanceMileage === null) {
    return <>{t("maintenance.value.empty")}</>;
  }

  return (
    <span className="block">
      {record.nextMaintenanceDate ? (
        <span className="block">
          {formatCalendarDate(record.nextMaintenanceDate)}
        </span>
      ) : null}
      {record.nextMaintenanceMileage !== null ? (
        <span className="block text-xs">
          {formatMileage(record.nextMaintenanceMileage)}{" "}
          {t("maintenance.value.km")}
        </span>
      ) : null}
    </span>
  );
}

/** Thin spaces rather than a locale format: a mileage is not money. */
function formatMileage(mileage: number): string {
  return mileage.toLocaleString("nl-BE");
}
