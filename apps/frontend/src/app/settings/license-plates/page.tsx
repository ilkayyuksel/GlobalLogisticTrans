"use client";

import Link from "next/link";
import { useCallback } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useAsync } from "@/hooks/use-async";
import { MAX_PAGE_SIZE } from "@/lib/api/trips";
import { listVehicles } from "@/lib/api/vehicles";
import { useTranslation } from "@/lib/i18n/language-provider";

/**
 * Settings → Nummerplaten.
 *
 * ── WHAT THIS PAGE IS, AND WHAT IT DELIBERATELY IS NOT ──────────────────────
 * A number plate is not a thing this system stores on its own. It is the
 * identifying field of a VEHICLE, and Vehicles are the source of truth for
 * trucks: the Ritten vehicle picker, the planning colour, the Driver
 * assignments and the maintenance history all hang off that one record.
 *
 * So this page does NOT manage plates. There is no plates endpoint, no plates
 * table, and creating one would mean a second list of trucks that could
 * disagree with the first — a plate edited here and not there would quietly
 * split one truck into two.
 *
 * What it does instead is answer the question someone arrives here with:
 * "which plates does the planning use?" It lists them, says which are active,
 * and sends every change to Vehicles, where the record actually lives.
 * ────────────────────────────────────────────────────────────────────────────
 */
export default function Page() {
  const t = useTranslation();

  const vehicles = useAsync(
    useCallback(
      (signal: AbortSignal) => listVehicles({ pageSize: MAX_PAGE_SIZE }, signal),
      [],
    ),
    [],
  );

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-4 text-xl font-semibold text-foreground">
        {t("page.licensePlates.title")}
      </h1>

      <Card className="mb-4">
        <CardBody>
          <p className="text-sm text-secondary">
            {t("licensePlates.explanation")}
          </p>
          <p className="mt-3">
            <Link
              href="/vehicles"
              className="text-sm font-medium text-primary hover:underline"
            >
              {t("licensePlates.manageInVehicles")}
            </Link>
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={t("licensePlates.inUseTitle")}
          description={t("licensePlates.inUseDescription")}
        />

        {vehicles.isLoading ? (
          <LoadingState label={t("vehicles.loading")} />
        ) : null}

        {!vehicles.isLoading && vehicles.error ? (
          <ErrorState error={vehicles.error} onRetry={vehicles.reload} />
        ) : null}

        {!vehicles.isLoading &&
        !vehicles.error &&
        vehicles.data?.items.length === 0 ? (
          <EmptyState title={t("vehicles.empty.title")} />
        ) : null}

        {!vehicles.isLoading && !vehicles.error && vehicles.data?.items.length ? (
          <ul className="divide-y divide-border">
            {vehicles.data.items.map((vehicle) => (
              <li
                key={vehicle.id}
                className="flex flex-wrap items-center gap-3 px-5 py-2.5"
              >
                <span
                  aria-hidden="true"
                  style={{ backgroundColor: vehicle.displayColor }}
                  className="inline-block h-3 w-3 shrink-0 rounded-sm"
                />

                <Link
                  href={`/vehicles/${vehicle.id}`}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  {vehicle.licensePlate}
                </Link>

                <span className="text-xs text-secondary">
                  {[vehicle.brand, vehicle.model].filter(Boolean).join(" ")}
                </span>

                {vehicle.isActive ? null : (
                  <Badge tone="warning">{t("vehicles.status.inactive")}</Badge>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
    </div>
  );
}
