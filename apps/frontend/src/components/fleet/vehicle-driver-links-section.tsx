"use client";

import { useCallback, useMemo, useState } from "react";

import { FleetFeedback, type FleetFeedbackMessage } from "@/components/fleet/fleet-feedback";
import { VehicleDriverLinkRow } from "@/components/fleet/vehicle-driver-link-row";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useAsync } from "@/hooks/use-async";
import { userFacingMessage } from "@/lib/api/client";
import { listActiveDrivers, listActiveVehicles } from "@/lib/api/fleet";
import type { VehicleAssignment } from "@/lib/api/types";
import { closeAssignment } from "@/lib/api/vehicles";
import {
  linkVehicleDriver,
  listActiveAssignments,
  type VehicleDriverLinkResult,
} from "@/lib/api/vehicle-driver-links";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { TranslationKey } from "@/lib/i18n/translations";

const COLUMN_KEYS: readonly TranslationKey[] = [
  "fleet.links.column.vehicle",
  "fleet.links.column.currentDriver",
  "fleet.links.column.status",
  "fleet.links.column.newDriver",
  "fleet.links.column.actions",
];

/**
 * Section A of the fleet page: one row per active truck, with today's driver.
 *
 * "Today's driver" is the backend's answer twice over — the vehicle's
 * `currentDriver` and the `activeOnly` assignment list both apply the period
 * rule, so a newer row that has not started, or one that ended yesterday, is
 * never shown as the link. A truck with nobody on it stays in the list.
 */
export function VehicleDriverLinksSection({
  version,
  onChanged,
}: {
  version: number;
  onChanged: () => void;
}) {
  const t = useTranslation();
  const [busyVehicleId, setBusyVehicleId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FleetFeedbackMessage | null>(null);

  const data = useAsync(
    useCallback(
      (signal: AbortSignal) =>
        Promise.all([
          listActiveVehicles(signal),
          listActiveAssignments(signal),
          listActiveDrivers(signal),
        ]),
      [],
    ),
    [version],
  );

  const assignmentByVehicle = useMemo(
    () => new Map((data.data?.[1].items ?? []).map((row) => [row.vehicleId, row])),
    [data.data],
  );

  async function run(
    vehicleId: string,
    operation: () => Promise<FleetFeedbackMessage>,
  ): Promise<void> {
    setBusyVehicleId(vehicleId);
    setFeedback(null);

    try {
      setFeedback(await operation());
      onChanged();
    } catch (error: unknown) {
      setFeedback({ text: t("fleet.links.failed"), detail: userFacingMessage(error), isError: true });
    } finally {
      setBusyVehicleId(null);
    }
  }

  function link(vehicleId: string, driverId: string): void {
    void run(vehicleId, async () => describeLink(await linkVehicleDriver(vehicleId, driverId)));
  }

  function end(assignment: VehicleAssignment): void {
    if (!window.confirm(t("vehicles.assignment.confirmEnd"))) {
      return;
    }

    void run(assignment.vehicleId, async () => {
      await closeAssignment(assignment.id);
      return { text: t("vehicles.assignment.ended"), isError: false };
    });
  }

  function describeLink(result: VehicleDriverLinkResult): FleetFeedbackMessage {
    if (result.outcome === "ALREADY_LINKED") {
      return { text: t("fleet.links.alreadyLinked"), isError: false };
    }

    return {
      text: t("vehicles.assignment.created"),
      detail:
        result.endedAssignments.length > 0
          ? t("fleet.links.endedCount").replace("{count}", String(result.endedAssignments.length))
          : undefined,
      isError: false,
    };
  }

  const isFirstLoad = data.isLoading && !data.data;

  return (
    <section id="koppelingen" aria-labelledby="links-heading" className="space-y-4">
      <div>
        <h2 id="links-heading" className="text-lg font-semibold text-foreground">
          {t("fleet.links.title")}
        </h2>
        <p className="text-sm text-secondary">{t("fleet.links.description")}</p>
      </div>

      <FleetFeedback feedback={feedback} />

      {isFirstLoad ? <LoadingState label={t("fleet.links.loading")} /> : null}

      {!isFirstLoad && data.error ? <ErrorState error={data.error} onRetry={data.reload} /> : null}

      {!isFirstLoad && !data.error && data.data ? (
        data.data[0].items.length === 0 ? (
          <EmptyState title={t("fleet.links.empty")} description={t("vehicles.empty.description")} />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[900px] text-left text-sm">
              <caption className="sr-only">{t("fleet.links.title")}</caption>
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
                {data.data[0].items.map((vehicle) => (
                  <VehicleDriverLinkRow
                    key={vehicle.id}
                    vehicle={vehicle}
                    assignment={assignmentByVehicle.get(vehicle.id) ?? null}
                    drivers={data.data?.[2].items ?? []}
                    isBusy={busyVehicleId === vehicle.id}
                    onLink={(driverId) => link(vehicle.id, driverId)}
                    onEnd={end}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </section>
  );
}
