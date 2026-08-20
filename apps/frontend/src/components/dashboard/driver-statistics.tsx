"use client";

import { useCallback } from "react";

import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { WidgetLink } from "@/components/dashboard/widget-link";
import { Badge } from "@/components/ui/badge";
import { useAsync } from "@/hooks/use-async";
import {
  getDriverStatistics,
  type DriverTripCounts,
} from "@/lib/api/driver-statistics";
import { useTranslation } from "@/lib/i18n/language-provider";

/**
 * How much work each driver has.
 *
 * ── EVERY NUMBER IS THE BACKEND'S ───────────────────────────────────────────
 * One request answers the whole widget. The counts are taken over the EFFECTIVE
 * driver — the Trip's override when it has one, otherwise whoever the truck was
 * assigned to on that day — and the windows are decided server-side, by the
 * same Monday-to-Sunday week the Ritten list uses.
 *
 * Nothing here resolves an assignment, tallies a Trip or works out when the
 * month began. There is no request per driver and no Trip list to count.
 * ────────────────────────────────────────────────────────────────────────────
 */
export function DriverStatisticsWidget() {
  const t = useTranslation();

  const statistics = useAsync(
    useCallback((signal: AbortSignal) => getDriverStatistics(signal), []),
    [],
  );

  const drivers = statistics.data?.drivers ?? [];

  return (
    <Card>
      <CardHeader title={t("dashboard.drivers.title")} />

      {statistics.isLoading ? <LoadingState /> : null}

      {!statistics.isLoading && statistics.error ? (
        <ErrorState error={statistics.error} onRetry={statistics.reload} />
      ) : null}

      {!statistics.isLoading && !statistics.error && drivers.length === 0 ? (
        <EmptyState title={t("dashboard.drivers.empty")} />
      ) : null}

      {!statistics.isLoading && !statistics.error && drivers.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              {t("dashboard.drivers.title")}
            </caption>
            <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
              <tr>
                <th scope="col" className="px-5 py-2 font-medium">
                  {t("dashboard.drivers.driver")}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {t("dashboard.drivers.today")}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {t("dashboard.drivers.week")}
                </th>
                <th scope="col" className="px-5 py-2 text-right font-medium">
                  {t("dashboard.drivers.month")}
                </th>
              </tr>
            </thead>
            <tbody>
              {drivers.map((driver) => (
                <DriverRow key={driver.driverId} driver={driver} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <CardBody>
        {/* The rule is the backend's; the widget credits it rather than restating it. */}
        <p className="text-[11px] text-muted">{t("dashboard.drivers.note")}</p>
        <p className="mt-3">
          <WidgetLink href="/drivers" labelKey="dashboard.drivers.link" />
        </p>
      </CardBody>
    </Card>
  );
}

function DriverRow({ driver }: { driver: DriverTripCounts }) {
  const t = useTranslation();

  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-5 py-2">
        <span className="flex items-center gap-2">
          <span className="font-medium text-foreground">
            {driver.driverName}
          </span>
          {/*
            An inactive driver appears only when they still have work in one of
            these windows, which is worth saying plainly.
          */}
          {driver.isActive ? null : (
            <Badge tone="neutral">{t("drivers.status.inactive")}</Badge>
          )}
        </span>
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-secondary">
        {driver.today}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-secondary">
        {driver.week}
      </td>
      <td className="px-5 py-2 text-right font-medium tabular-nums text-foreground">
        {driver.month}
      </td>
    </tr>
  );
}
