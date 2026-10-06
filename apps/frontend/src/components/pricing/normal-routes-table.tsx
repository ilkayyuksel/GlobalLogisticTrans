"use client";

import { RouteForm } from "@/components/pricing/route-form";
import { RouteRow } from "@/components/pricing/route-row";
import { RouteTableHead } from "@/components/pricing/route-table-head";
import type { RouteConfiguration } from "@/lib/api/route-configuration";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { RouteDraft, RouteField } from "@/lib/pricing/route-draft";

/** The selection tick, Van, Naar, Tarief, Toll, Tunnel, the review tick, Acties. */
export const ROUTE_COLUMN_COUNT = 8;

/**
 * The ordinary routes, as one table: the add form on top, then every shown
 * route, each editable where it stands.
 *
 * Draws only. Every write is the section's — see `RoutePricesSection` — so this
 * table and the Combinations beside it go through one set of handlers.
 */
export function NormalRoutesTable({
  routes,
  draft,
  busyId,
  isRefreshing,
  hasSearch,
  isRouteSelected,
  onToggleSelected,
  onDraftChange,
  onSave,
  onCancel,
  onDelete,
  onSaveField,
  onReview,
}: {
  routes: readonly RouteConfiguration[];
  /** A route being added, shown as the first row. */
  draft: RouteDraft | null;
  busyId: string | null;
  isRefreshing: boolean;
  hasSearch: boolean;
  isRouteSelected: (id: string) => boolean;
  onToggleSelected: (id: string) => void;
  onDraftChange: (draft: RouteDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: (route: RouteConfiguration) => void;
  onSaveField: (
    route: RouteConfiguration,
    field: RouteField,
    value: string,
  ) => Promise<void>;
  onReview: (route: RouteConfiguration, reviewed: boolean) => void;
}) {
  const t = useTranslation();

  return (
    <div className="mt-3 overflow-x-auto" aria-busy={isRefreshing}>
      <table className="w-full min-w-[760px] text-left text-sm">
        <caption className="sr-only">
          {t("settings.pricing.routes.sections.normal")}
        </caption>
        <RouteTableHead />
        <tbody>
          {draft ? (
            <RouteForm
              draft={draft}
              isBusy={busyId === "new"}
              onChange={onDraftChange}
              onSave={onSave}
              onCancel={onCancel}
            />
          ) : null}

          {routes.map((route) => (
            <RouteRow
              key={route.id}
              route={route}
              isBusy={busyId === route.id}
              isSelected={isRouteSelected(route.id)}
              onToggleSelected={() => onToggleSelected(route.id)}
              onDelete={() => onDelete(route)}
              onSaveField={(field, value) => onSaveField(route, field, value)}
              onReview={(reviewed) => onReview(route, reviewed)}
            />
          ))}

          {/* A search that matched nothing says so, rather than an empty table. */}
          {hasSearch && routes.length === 0 ? (
            <tr>
              <td
                colSpan={ROUTE_COLUMN_COUNT}
                className="px-3 py-4 text-center text-xs text-muted"
              >
                {t("settings.pricing.routes.noResults")}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
