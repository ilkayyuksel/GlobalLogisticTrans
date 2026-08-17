"use client";

import type { ListTripsParams } from "@/lib/api/trips";
import type { CustomProperty, TripStatus, Vehicle } from "@/lib/api/types";
import { useTranslation } from "@/lib/i18n/language-provider";
import { cn } from "@/lib/cn";

/**
 * The filters Ritten offers.
 *
 * Every control maps to a query parameter the backend already accepts, and
 * nothing is filtered in the browser: a browser-side filter would only apply to
 * the page in view and would look like it worked while ignoring the rest of the
 * period.
 *
 * Three of the four are pickers rather than text boxes, because each one has a
 * closed set of real answers and typing is how a filter silently returns
 * nothing: an operator cannot know that the string is `PSA Quay 869` and not
 * `PSA quay 869`, and the backend matches exactly.
 *
 * Where those answers come from differs, and it matters:
 *   - Vehicles and Custom Properties are configuration, so they are listed from
 *     their own endpoints.
 *   - Terminals are NOT configuration. There is no terminal master data in this
 *     system; the string a transport order printed IS the terminal. So the
 *     options are the distinct values the Trips themselves carry, which is
 *     exactly what `GET /trips/terminals` reports.
 *
 * The plate filter sends a vehicle ID, because that is what the API matches on;
 * the operator still picks a plate, which is what they know.
 */

export interface RittenFilterValues {
  search: string;
  status: TripStatus | "";
  vehicleId: string;
  /** Exact, as printed on the transport order. */
  terminal: string;
  /** A Custom Property id; the backend filters Trips carrying it. */
  customPropertyId: string;
}

export const EMPTY_RITTEN_FILTERS: RittenFilterValues = {
  search: "",
  status: "",
  vehicleId: "",
  terminal: "",
  customPropertyId: "",
};

export function hasActiveRittenFilters(values: RittenFilterValues): boolean {
  return (
    values.search.trim() !== "" ||
    values.status !== "" ||
    values.vehicleId !== "" ||
    values.terminal.trim() !== "" ||
    values.customPropertyId !== ""
  );
}

/** The filter half of the query; the period half comes from `period.ts`. */
export function toFilterParams(
  values: RittenFilterValues,
  search: string,
): ListTripsParams {
  return {
    search: search.trim() === "" ? undefined : search.trim(),
    status: values.status === "" ? undefined : values.status,
    vehicleId: values.vehicleId === "" ? undefined : values.vehicleId,
    terminal: values.terminal.trim() === "" ? undefined : values.terminal.trim(),
    customPropertyId:
      values.customPropertyId === "" ? undefined : values.customPropertyId,
  };
}

const STATUS_CHOICES: readonly (TripStatus | "")[] = ["OPEN", "CLOSED", ""];

export function RittenFilters({
  values,
  vehicles,
  terminals,
  customProperties,
  onChange,
  onReset,
}: {
  values: RittenFilterValues;
  /** Fetched once by the page and shared with the inline editors. */
  vehicles: readonly Vehicle[];
  /** Every terminal the Trips carry, from the backend. */
  terminals: readonly string[];
  /** Active Custom Properties, from their own endpoint. */
  customProperties: readonly CustomProperty[];
  onChange: (values: RittenFilterValues) => void;
  onReset: () => void;
}) {
  const t = useTranslation();

  const update = (patch: Partial<RittenFilterValues>) => {
    onChange({ ...values, ...patch });
  };

  const statusLabel = (status: TripStatus | "") =>
    status === "" ? t("ritten.filter.statusAll") : t(`status.${status}`);

  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-border px-4 py-3">
      <Field label={t("ritten.search.label")} htmlFor="ritten-search" className="min-w-64 flex-1">
        <input
          id="ritten-search"
          type="search"
          value={values.search}
          onChange={(event) => update({ search: event.target.value })}
          placeholder={t("ritten.search.placeholder")}
          className="w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground placeholder:text-muted"
        />
      </Field>

      <Field label={t("ritten.filter.vehicle")} htmlFor="ritten-vehicle">
        <select
          id="ritten-vehicle"
          value={values.vehicleId}
          onChange={(event) => update({ vehicleId: event.target.value })}
          className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
        >
          <option value="">{t("ritten.filter.vehicleAll")}</option>
          {vehicles.map((vehicle) => (
            <option key={vehicle.id} value={vehicle.id}>
              {vehicle.licensePlate}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label={t("ritten.filter.terminal")}
        htmlFor="ritten-terminal"
        //hint={t("ritten.filter.terminalHint")}
      >
        <select
          id="ritten-terminal"
          value={values.terminal}
          onChange={(event) => update({ terminal: event.target.value })}
          className="max-w-56 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
        >
          <option value="">{t("ritten.filter.terminalAll")}</option>
          {terminals.map((terminal) => (
            <option key={terminal} value={terminal}>
              {terminal}
            </option>
          ))}
          {/*
            A terminal can be filtered on and then disappear from the list —
            the last Trip carrying it was deleted, say. Keeping the current
            value as an option stops the picker from silently showing "all"
            while the rows are still filtered.
          */}
          {values.terminal !== "" && !terminals.includes(values.terminal) ? (
            <option value={values.terminal}>{values.terminal}</option>
          ) : null}
        </select>
      </Field>

      <Field label={t("ritten.filter.customValue")} htmlFor="ritten-custom-value">
        <select
          id="ritten-custom-value"
          value={values.customPropertyId}
          onChange={(event) => update({ customPropertyId: event.target.value })}
          className="max-w-56 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
        >
          <option value="">{t("ritten.filter.customValueAll")}</option>
          {customProperties.map((property) => (
            <option key={property.id} value={property.id}>
              {property.name}
            </option>
          ))}
        </select>
      </Field>

      <div role="radiogroup" aria-label={t("ritten.filter.status")} className="inline-flex rounded-md border border-border bg-card p-0.5">
        {STATUS_CHOICES.map((status) => (
          <button
            key={status === "" ? "all" : status}
            type="button"
            role="radio"
            aria-checked={values.status === status}
            onClick={() => update({ status })}
            className={cn(
              "rounded px-3 py-1.5 text-sm font-medium",
              values.status === status
                ? "bg-primary text-white"
                : "text-secondary hover:bg-hover hover:text-foreground",
            )}
          >
            {statusLabel(status)}
          </button>
        ))}
      </div>

      {hasActiveRittenFilters(values) ? (
        <button
          type="button"
          onClick={onReset}
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-hover"
        >
          {t("ritten.filter.clear")}
        </button>
      ) : null}
    </div>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label
        htmlFor={htmlFor}
        className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted"
      >
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1 text-[11px] text-muted">{hint}</p> : null}
    </div>
  );
}
