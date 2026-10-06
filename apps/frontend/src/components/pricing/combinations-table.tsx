"use client";

import { CombinationRouteForm } from "@/components/pricing/combination-route-form";
import {
  CombinationRows,
  type CombinationDraft,
} from "@/components/pricing/combination-routes";
import { ROUTE_COLUMN_COUNT } from "@/components/pricing/normal-routes-table";
import { RouteTableHead } from "@/components/pricing/route-table-head";
import type { CombinationRouteConfiguration } from "@/lib/api/route-configuration";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { OverStField, RouteField } from "@/lib/pricing/route-draft";

/**
 * The Combinations: the add form at the TOP, then every shown Combination as
 * its own group of rows — two legs and Over ST.
 *
 * ── THE NUMBER IS THE RECORD'S, NOT ITS ROW'S ───────────────────────────────
 * A Combination is called "#3" after its place in the stored order, which does
 * not move while searching, filtering or when a new one is shown first. Naming
 * it by its row would rename every Combination below the first each time the
 * list changed.
 *
 * Draws only; every write is the section's.
 */
export function CombinationsTable({
  combinations,
  numberOf,
  draft,
  busyId,
  isRefreshing,
  hasSearch,
  isCombinationSelected,
  onToggleSelected,
  onDraftChange,
  onSave,
  onCancel,
  onDelete,
  onSyncLeg,
  onSaveLegField,
  onSaveOverStField,
  onReview,
}: {
  combinations: readonly CombinationRouteConfiguration[];
  /** The 0-based position of a Combination in the stored order. */
  numberOf: (combination: CombinationRouteConfiguration) => number;
  draft: CombinationDraft | null;
  busyId: string | null;
  isRefreshing: boolean;
  hasSearch: boolean;
  isCombinationSelected: (id: string) => boolean;
  onToggleSelected: (id: string) => void;
  onDraftChange: (draft: CombinationDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: (combination: CombinationRouteConfiguration) => void;
  onSyncLeg: (combination: CombinationRouteConfiguration, legIndex: number) => void;
  onSaveLegField: (
    combination: CombinationRouteConfiguration,
    legIndex: number,
    field: RouteField,
    value: string,
  ) => Promise<void>;
  onSaveOverStField: (
    combination: CombinationRouteConfiguration,
    field: OverStField,
    value: string,
  ) => Promise<void>;
  onReview: (combination: CombinationRouteConfiguration, reviewed: boolean) => void;
}) {
  const t = useTranslation();

  return (
    <div className="mt-3">
      {/* Adding comes first, above every Combination that already exists. */}
      {draft ? (
        <CombinationRouteForm
          draft={draft}
          isBusy={busyId === "new"}
          onChange={onDraftChange}
          onSave={onSave}
          onCancel={onCancel}
        />
      ) : null}

      <div className="overflow-x-auto" aria-busy={isRefreshing}>
        <table className="w-full min-w-[760px] text-left text-sm">
          <caption className="sr-only">
            {t("settings.pricing.routes.sections.combinations")}
          </caption>
          <RouteTableHead />
          {/*
            Each Combination is one `<tbody>` of its own: the same rows and
            columns as an ordinary route, with a quiet header row saying the two
            legs and Over ST belong together.
          */}
          {combinations.map((combination) => (
            <CombinationRows
              key={combination.id}
              combination={combination}
              index={numberOf(combination)}
              isBusy={busyId === combination.id}
              isSelected={isCombinationSelected(combination.id)}
              columnCount={ROUTE_COLUMN_COUNT}
              onToggleSelected={() => onToggleSelected(combination.id)}
              onDelete={() => onDelete(combination)}
              onSyncLeg={(legIndex) => onSyncLeg(combination, legIndex)}
              onSaveLegField={(legIndex, field, value) =>
                onSaveLegField(combination, legIndex, field, value)
              }
              onSaveOverStField={(field, value) =>
                onSaveOverStField(combination, field, value)
              }
              onReview={(reviewed) => onReview(combination, reviewed)}
            />
          ))}

          {hasSearch && combinations.length === 0 ? (
            <tbody>
              <tr>
                <td
                  colSpan={ROUTE_COLUMN_COUNT}
                  className="px-3 py-4 text-center text-xs text-muted"
                >
                  {t("settings.pricing.routes.noResults")}
                </td>
              </tr>
            </tbody>
          ) : null}
        </table>
      </div>
    </div>
  );
}
