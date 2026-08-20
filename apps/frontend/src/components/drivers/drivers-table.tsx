"use client";

import { Badge } from "@/components/ui/badge";
import type { Driver } from "@/lib/api/types";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { TranslationKey } from "@/lib/i18n/translations";
import { cn } from "@/lib/cn";

/**
 * The drivers, as a table.
 *
 * Separated from the page so the page stays about STATE — search, paging, which
 * dialog is open — and this stays about presentation. It renders exactly what
 * it is given and decides nothing: whether a driver may be deactivated, and
 * what that means, is the backend's.
 */

const COLUMN_KEYS: readonly TranslationKey[] = [
  "drivers.column.name",
  "drivers.column.licenceNumber",
  "drivers.column.phoneNumber",
  "drivers.column.email",
  "drivers.column.status",
  "drivers.column.actions",
];

export function DriversTable({
  drivers,
  busyDriverId,
  onEdit,
  onToggleActivation,
}: {
  drivers: readonly Driver[];
  /** The driver a mutation is currently running for. */
  busyDriverId: string | null;
  onEdit: (driver: Driver) => void;
  onToggleActivation: (driver: Driver) => void;
}) {
  const t = useTranslation();

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[900px] text-left text-sm">
        <caption className="sr-only">{t("drivers.title")}</caption>
        <thead className="border-b border-border bg-hover/50 text-xs uppercase tracking-wide text-muted">
          <tr>
            {COLUMN_KEYS.map((key) => (
              <th
                key={key}
                scope="col"
                className="whitespace-nowrap px-3 py-2 font-medium"
              >
                {t(key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {drivers.map((driver) => (
            <DriverRow
              key={driver.id}
              driver={driver}
              isBusy={busyDriverId === driver.id}
              onEdit={() => onEdit(driver)}
              onToggleActivation={() => onToggleActivation(driver)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DriverRow({
  driver,
  isBusy,
  onEdit,
  onToggleActivation,
}: {
  driver: Driver;
  isBusy: boolean;
  onEdit: () => void;
  onToggleActivation: () => void;
}) {
  const t = useTranslation();
  const empty = t("drivers.value.empty");

  return (
    <tr className="border-b border-border last:border-0 hover:bg-hover">
      <td className="px-3 py-2 font-medium text-foreground">{driver.name}</td>
      <td className="px-3 py-2 text-secondary">
        {driver.licenceNumber ?? empty}
      </td>
      <td className="px-3 py-2 text-secondary">
        {driver.phoneNumber ?? empty}
      </td>
      <td className="px-3 py-2 text-secondary">{driver.email ?? empty}</td>
      <td className="px-3 py-2">
        <Badge tone={driver.isActive ? "success" : "neutral"}>
          {driver.isActive
            ? t("drivers.status.active")
            : t("drivers.status.inactive")}
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
            {t("drivers.action.edit")}
          </button>
          <button
            type="button"
            onClick={onToggleActivation}
            disabled={isBusy}
            className={cn(
              "text-sm font-medium disabled:opacity-50",
              driver.isActive
                ? "text-danger hover:underline"
                : "text-primary hover:underline",
            )}
          >
            {driver.isActive
              ? t("drivers.action.deactivate")
              : t("drivers.action.activate")}
          </button>
        </span>
      </td>
    </tr>
  );
}
