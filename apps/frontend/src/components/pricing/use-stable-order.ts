"use client";

import { useState } from "react";

import { inPreviousOrder } from "@/lib/pricing/stable-order";

/**
 * The records of a list, in the order this visit first showed them.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 * The backend sorts ordinary routes by name. Every refetch — a review tick, a
 * deletion, a leg sync — therefore moved a route whose Van or Naar had just
 * been edited to its new alphabetical place, and the operator lost the row
 * they were working on. Within one visit the order now stays what it was; the
 * next full page load shows the backend's sort again, because the remembered
 * order lives in this component's state and nowhere else.
 *
 * Only the ORDER is kept: the records themselves are always the newest the
 * list delivered. A failed load (no list) forgets nothing, so the list that
 * follows it is still shown in the order the operator knows.
 *
 * Adjusted while rendering, the way React documents for state that follows a
 * prop — an effect would paint the backend's order for one frame first.
 */
export function useStableOrder<TRecord extends { readonly id: string }>(
  records: readonly TRecord[] | null,
): readonly TRecord[] {
  const [shown, setShown] = useState<{
    basis: readonly TRecord[] | null;
    order: readonly string[] | null;
    ordered: readonly TRecord[];
  }>({ basis: null, order: null, ordered: [] });

  if (records === shown.basis) {
    return shown.ordered;
  }

  if (records === null) {
    setShown({ ...shown, basis: null, ordered: [] });

    return [];
  }

  // The first list of this visit is shown exactly as the backend sorted it.
  const ordered = shown.order === null ? [...records] : inPreviousOrder(records, shown.order);

  setShown({ basis: records, order: ordered.map((record) => record.id), ordered });

  return ordered;
}
