"use client";

import { useState } from "react";

/**
 * Which configurations an operator has selected for a bulk action.
 *
 * ── ONLY WHAT IS ON SCREEN COUNTS ───────────────────────────────────────────
 * The selection an action works from is always the ticked records that the list
 * SHOWS now. A route ticked under "Alle" and then hidden by the "Nog te doen"
 * filter is not deleted by a button the operator presses while it is out of
 * sight, and a record that a refetch no longer returns simply drops out. That is
 * derived on every render rather than kept in step by an effect, so it cannot
 * drift.
 *
 * Ordinary routes and Combinations are kept apart because the backend deletes
 * them differently: a route by its own id, a Combination by its group — never by
 * a leg, so it always goes whole.
 */
export function useRouteSelection({
  shownRouteIds,
  shownCombinationIds,
}: {
  shownRouteIds: readonly string[];
  shownCombinationIds: readonly string[];
}) {
  const [ticked, setTicked] = useState<{
    routes: ReadonlySet<string>;
    combinations: ReadonlySet<string>;
  }>({ routes: new Set(), combinations: new Set() });

  const routeIds = shownRouteIds.filter((id) => ticked.routes.has(id));
  const combinationGroupIds = shownCombinationIds.filter((id) =>
    ticked.combinations.has(id),
  );

  function toggle(kind: "routes" | "combinations", id: string): void {
    setTicked((current) => {
      const next = new Set(current[kind]);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return { ...current, [kind]: next };
    });
  }

  return {
    routeIds,
    combinationGroupIds,
    count: routeIds.length + combinationGroupIds.length,
    isRouteSelected: (id: string) => ticked.routes.has(id),
    isCombinationSelected: (id: string) => ticked.combinations.has(id),
    toggleRoute: (id: string) => toggle("routes", id),
    toggleCombination: (id: string) => toggle("combinations", id),
    selectAllShown: () =>
      setTicked({
        routes: new Set(shownRouteIds),
        combinations: new Set(shownCombinationIds),
      }),
    clear: () => setTicked({ routes: new Set(), combinations: new Set() }),
  };
}

export type RouteSelection = ReturnType<typeof useRouteSelection>;
