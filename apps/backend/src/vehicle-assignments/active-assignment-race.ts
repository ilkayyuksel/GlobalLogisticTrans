import { ConflictException } from "@nestjs/common";

import { violatesUniqueConstraint } from "../common/unique-violation";

/**
 * The two partial unique indexes that make "one driver per truck, one truck
 * per driver" hold even when two people link at the same moment.
 */
const ACTIVE_ASSIGNMENT_INDEXES = [
  { columns: ["vehicle_id"], indexName: "vehicle_assignment_active_vehicle_key" },
  { columns: ["driver_id"], indexName: "vehicle_assignment_active_driver_key" },
] as const;

export class ConcurrentAssignmentChangeException extends ConflictException {
  constructor() {
    super(
      "Another change to this vehicle or driver was saved at the same moment. Nothing was changed; reload and try again.",
    );
  }
}

/**
 * Runs an assignment write, reporting a lost race on the active-assignment
 * indexes as a 409 instead of a 500.
 *
 * The service's own checks read before they write, so two concurrent writers
 * can both pass them; the database then refuses the second one and its whole
 * transaction rolls back. Any other error is rethrown untouched.
 */
export async function translateActiveAssignmentRace<TResult>(
  write: () => Promise<TResult>,
): Promise<TResult> {
  try {
    return await write();
  } catch (error) {
    if (
      ACTIVE_ASSIGNMENT_INDEXES.some((index) =>
        violatesUniqueConstraint(error, index),
      )
    ) {
      throw new ConcurrentAssignmentChangeException();
    }

    throw error;
  }
}
