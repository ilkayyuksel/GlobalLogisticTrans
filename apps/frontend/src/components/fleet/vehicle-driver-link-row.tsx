"use client";

import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import type { Driver, Vehicle, VehicleAssignment } from "@/lib/api/types";
import { formatCalendarDate } from "@/lib/calendar/calendar-dates";
import { useTranslation } from "@/lib/i18n/language-provider";

/** A DATE column as the operator reads it. */
function calendarDate(isoDate: string): string {
  return formatCalendarDate(isoDate) ?? isoDate;
}

/**
 * One truck: who drives it today, and the two things that can change that.
 *
 * The only choice to make is the NEW driver. The current one is shown so it is
 * clear what is being replaced; ending it — and ending the new driver's other
 * truck — is the backend's, in the same request.
 */
export function VehicleDriverLinkRow({
  vehicle,
  assignment,
  drivers,
  isBusy,
  onLink,
  onEnd,
}: {
  vehicle: Vehicle;
  /** The assignment in effect today, if the truck has one. */
  assignment: VehicleAssignment | null;
  /** Active drivers to choose from. */
  drivers: readonly Driver[];
  isBusy: boolean;
  onLink: (driverId: string) => void;
  onEnd: (assignment: VehicleAssignment) => void;
}) {
  const t = useTranslation();
  const [driverId, setDriverId] = useState("");
  const current = vehicle.currentDriver;
  const choices = drivers.filter((driver) => driver.id !== current?.id);

  return (
    <tr className="border-b border-border last:border-0 hover:bg-hover">
      <td className="px-3 py-2">
        <span className="flex items-center gap-2">
          <span
            aria-hidden="true"
            style={{ backgroundColor: vehicle.displayColor }}
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
          />
          <Link href={`/vehicles/${vehicle.id}`} className="font-medium text-primary hover:underline">
            {vehicle.licensePlate}
          </Link>
        </span>
      </td>
      <td className="px-3 py-2">
        {current ? (
          <span className={current.isActive ? "text-foreground" : "text-muted"}>{current.name}</span>
        ) : (
          <Badge tone="warning">{t("fleet.links.noDriver")}</Badge>
        )}
      </td>
      <td className="px-3 py-2 text-secondary">
        {assignment
          ? assignment.validTo === null
            ? t("fleet.links.activeSince").replace("{date}", calendarDate(assignment.validFrom))
            : t("fleet.links.activeUntil")
                .replace("{from}", calendarDate(assignment.validFrom))
                .replace("{to}", calendarDate(assignment.validTo))
          : t("fleet.links.noAssignment")}
      </td>
      <td className="px-3 py-2">
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            onLink(driverId);
            setDriverId("");
          }}
        >
          <select
            aria-label={t("fleet.links.newDriverFor").replace("{plate}", vehicle.licensePlate)}
            value={driverId}
            onChange={(event) => setDriverId(event.target.value)}
            disabled={isBusy}
            className="min-w-48 rounded-md border border-border bg-card px-2 py-1 text-sm text-foreground"
          >
            <option value="">{t("fleet.links.chooseDriver")}</option>
            {choices.map((driver) => (
              <option key={driver.id} value={driver.id}>
                {driver.currentVehicle
                  ? t("fleet.links.driverOnOtherVehicle")
                      .replace("{name}", driver.name)
                      .replace("{plate}", driver.currentVehicle.licensePlate)
                  : driver.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={isBusy || driverId === ""}
            className="rounded-md bg-primary px-3 py-1 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
          >
            {t("fleet.links.link")}
          </button>
        </form>
      </td>
      <td className="px-3 py-2">
        {assignment ? (
          <button
            type="button"
            onClick={() => onEnd(assignment)}
            disabled={isBusy}
            className="text-sm font-medium text-danger hover:underline disabled:opacity-50"
          >
            {t("vehicles.assignment.end")}
          </button>
        ) : null}
      </td>
    </tr>
  );
}
