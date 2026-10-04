/**
 * Records an inline edit answered, laid over the list it was made on.
 *
 * Tied to that list by identity: once a refetch delivers a new list, the
 * overlay no longer applies — a fresh list is a better answer than a remembered
 * one. Derived on every render rather than cleared by hand, so a refetch that
 * runs while the table stays on screen can never show a value older than the
 * one an operator just saved.
 */
export interface SavedOverlay<TRecord> {
  readonly basis: unknown;
  readonly records: ReadonlyMap<string, TRecord>;
}

export const NO_OVERLAY: SavedOverlay<never> = {
  basis: null,
  records: new Map<string, never>(),
};

export function overlayFor<TRecord>(
  overlay: SavedOverlay<TRecord>,
  basis: unknown,
): ReadonlyMap<string, TRecord> {
  return overlay.basis === basis ? overlay.records : NO_OVERLAY.records;
}

export function withSaved<TRecord extends { id: string }>(
  overlay: SavedOverlay<TRecord>,
  basis: unknown,
  saved: TRecord,
): SavedOverlay<TRecord> {
  return {
    basis,
    records: new Map(overlayFor(overlay, basis)).set(saved.id, saved),
  };
}

