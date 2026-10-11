"use client";

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import type { Vehicle } from "@/lib/api/types";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { TranslationKey } from "@/lib/i18n/translations";
import { cn } from "@/lib/cn";

const COLUMN_KEYS: readonly TranslationKey[] = [
  "vehicles.column.licensePlate",
  // Today's driver, next to the plate — the pairing an operator reads the
  // fleet list to find.
  "vehicles.column.currentDriver",
  "vehicles.column.description",
  "vehicles.column.brand",
  "vehicles.column.model",
  "vehicles.column.year",
  "vehicles.column.status",
  "vehicles.column.actions",
];

/** The fleet list. Renders what it is given; every decision is the section's. */
export function VehiclesTable({
  vehicles,
  busyVehicleId,
  onEdit,
  onToggleActivation,
}: {
  vehicles: readonly Vehicle[];
  busyVehicleId: string | null;
  onEdit: (vehicle: Vehicle) => void;
  onToggleActivation: (vehicle: Vehicle) => void;
}) {
  const t = useTranslation();

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[900px] text-left text-sm">
        <caption className="sr-only">{t("vehicles.title")}</caption>
        <thead className="border-b border-border bg-hover/50 text-xs uppercase tracking-wide text-muted">
          <tr>
            {COLUMN_KEYS.map((key) => (
              <th key={key} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">
                {t(key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {vehicles.map((vehicle) => (
            <VehicleRow
              key={vehicle.id}
              vehicle={vehicle}
              isBusy={busyVehicleId === vehicle.id}
              onEdit={() => onEdit(vehicle)}
              onToggleActivation={() => onToggleActivation(vehicle)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One vehicle, with its edit and (de)activation actions. */
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
      {/*
        The CURRENT driver, from VehicleAssignment — never the driver of the
        last Trip, which is a fact about a day rather than about now. A driver
        deactivated while still assigned is still shown, because the truck is
        still down to them; the name is dimmed rather than hidden so the state
        is visible instead of silently missing.
      */}
      <td className="px-3 py-2">
        {vehicle.currentDriver ? (
          <Link
            href="#chauffeurs"
            className={
              vehicle.currentDriver.isActive
                ? "text-foreground hover:underline"
                : "text-muted hover:underline"
            }
          >
            {vehicle.currentDriver.name}
          </Link>
        ) : (
          <span className="text-secondary">{empty}</span>
        )}
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
