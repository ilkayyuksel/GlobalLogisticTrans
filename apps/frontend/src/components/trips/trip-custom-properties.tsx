"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { TripCustomProperty } from "@/lib/api/types";

/**
 * The Custom Properties assigned to a Trip.
 *
 * The configured price is shown where one exists, as the string the backend
 * sent. It is a configuration value, not a calculated charge — what a property
 * actually contributed to this Trip appears as a line in the pricing
 * breakdown, which is the only place a priced amount is authoritative.
 */
export function TripCustomProperties({
  properties,
}: {
  properties: TripCustomProperty[];
}) {
  const t = useTranslation();

  return (
    <Card>
      <CardHeader
        title={t("tripDetail.custom.title")}
        description={
          properties.length > 0
            ? `${properties.length} ${t("tripDetail.custom.assigned")}`
            : t("tripDetail.custom.noneAssigned")
        }
      />

      {properties.length === 0 ? (
        <EmptyState
          title={t("tripDetail.custom.emptyTitle")}
          description={t("tripDetail.custom.emptyDescription")}
        />
      ) : (
        <ul className="divide-y divide-border">
          {properties.map((assignment) => (
            <li
              key={assignment.id}
              className="flex items-start justify-between gap-4 px-5 py-3"
            >
              <div>
                <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                  {assignment.customProperty.name}
                  {/*
                    A property can be deactivated after it was assigned. The
                    assignment stands — and its priced line stays in the
                    snapshot — so the state is shown rather than hidden.
                  */}
                  {assignment.customProperty.isActive ? null : (
                    <Badge tone="neutral">
                      {t("vehicles.status.inactive")}
                    </Badge>
                  )}
                </p>
                {assignment.customProperty.description ? (
                  <p className="mt-0.5 text-sm text-secondary">
                    {assignment.customProperty.description}
                  </p>
                ) : null}
              </div>

              {/*
                The CONFIGURED price, not a charge. What this property actually
                contributed to this trip is a line in the pricing breakdown,
                which is the only authoritative place for an amount.
              */}
              {assignment.customProperty.defaultPrice ? (
                <span
                  title={t("tripDetail.custom.configuredPrice")}
                  className="shrink-0 text-sm tabular-nums text-secondary"
                >
                  {assignment.customProperty.defaultPrice}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
