/**
 * A refetched list, in the order the screen already showed.
 *
 * Records the screen already placed keep their place, in `previousOrder`. A
 * record the screen has not placed yet — an import, a Combination a sync
 * touched for the first time — goes directly after the record that precedes it
 * in `records` (the backend's own sort), or first when nothing does. Records
 * that are gone simply drop out.
 *
 * Pure and deterministic: the same inputs always give the same order.
 */
export function inPreviousOrder<TRecord extends { readonly id: string }>(
  records: readonly TRecord[],
  previousOrder: readonly string[],
): TRecord[] {
  const placedAt = new Map(previousOrder.map((id, index) => [id, index]));
  const ordered = records
    .filter((record) => placedAt.has(record.id))
    .sort((left, right) => (placedAt.get(left.id) ?? 0) - (placedAt.get(right.id) ?? 0));

  records.forEach((record, index) => {
    if (placedAt.has(record.id)) {
      return;
    }

    const predecessor = index > 0 ? records[index - 1] : null;
    const after = predecessor ? ordered.findIndex((each) => each.id === predecessor.id) : -1;

    ordered.splice(after + 1, 0, record);
  });

  return ordered;
}
