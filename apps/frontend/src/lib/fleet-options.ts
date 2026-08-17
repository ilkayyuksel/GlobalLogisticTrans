/**
 * The options a vehicle or driver picker may offer.
 *
 * ONE implementation of the rule that matters, used by the Trip detail form and
 * by Ritten's inline editing. Two would eventually disagree about the case that
 * matters: a Trip whose vehicle or driver has since been DEACTIVATED. That
 * record is absent from the active list, and a picker that simply dropped it
 * would send null the next time anything was saved — silently unassigning a
 * truck nobody touched.
 *
 * Only active records are offered as new choices, because the backend refuses
 * to assign an inactive one. The current assignment is kept regardless and
 * marked, so it can be seen and deliberately changed.
 *
 * How an option READS is left to the caller: a form with room shows the plate
 * and the model, a table cell shows the plate. Only the rule is shared.
 */

export interface FleetOption {
  readonly value: string;
  readonly label: string;
  /** True for the Trip's current assignment when it is no longer active. */
  readonly isCurrentInactive: boolean;
}

export function toFleetOptions<TRecord extends { id: string }>(
  records: readonly TRecord[],
  labelOf: (record: TRecord) => string,
  /** The Trip's current assignment, or null when it has none. */
  currentId: string | null,
  /** How to name that assignment if it is not in `records`. */
  currentLabel: string | undefined,
): FleetOption[] {
  const options = records.map((record) => ({
    value: record.id,
    label: labelOf(record),
    isCurrentInactive: false,
  }));

  if (!currentId || options.some((option) => option.value === currentId)) {
    return options;
  }

  return [
    ...options,
    {
      value: currentId,
      label: currentLabel ?? currentId,
      isCurrentInactive: true,
    },
  ];
}
