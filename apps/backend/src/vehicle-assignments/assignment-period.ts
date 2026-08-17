import { VehicleAssignment } from "@prisma/client";

/**
 * When a VehicleAssignment is in effect.
 *
 * THE SINGLE DEFINITION OF THIS RULE. The repository's SQL predicate and the
 * in-memory selection used for a page of Trips both express the same period —
 * `validFrom <= date <= validTo`, with a null `validTo` meaning "never ends" —
 * and this file is where that sentence lives so the two cannot drift into
 * disagreeing about a boundary day.
 *
 * Both ends are INCLUSIVE. An assignment valid from the 1st to the 10th covers
 * a Trip planned on the 1st and a Trip planned on the 10th.
 *
 * Dates are compared as calendar days: `valid_from` and `valid_to` are DATE
 * columns and a Trip's planning date is stored at UTC midnight, so both sides
 * are already normalised and a plain comparison is exact.
 */
export function isInEffectOn(
  assignment: Pick<VehicleAssignment, "validFrom" | "validTo">,
  date: Date,
): boolean {
  if (assignment.validFrom.getTime() > date.getTime()) {
    return false;
  }

  return (
    assignment.validTo === null ||
    assignment.validTo.getTime() >= date.getTime()
  );
}

/**
 * The assignment that governs a vehicle on a date, from a set of candidates.
 *
 * When more than one covers the date — which the create and update rules are
 * meant to prevent, but which nothing stops a direct database edit from
 * producing — the one that started most recently wins. That matches the
 * `orderBy: { validFrom: "desc" }` the single-assignment lookup already uses,
 * so both paths answer the same question the same way.
 */
export function assignmentInEffect(
  candidates: readonly VehicleAssignment[],
  date: Date,
): VehicleAssignment | null {
  let selected: VehicleAssignment | null = null;

  for (const candidate of candidates) {
    if (!isInEffectOn(candidate, date)) {
      continue;
    }

    if (!selected || candidate.validFrom.getTime() > selected.validFrom.getTime()) {
      selected = candidate;
    }
  }

  return selected;
}
