import { Module } from "@nestjs/common";

import { CurrentAssignmentService } from "./current-assignment.service";
import { VehicleAssignmentRepository } from "./vehicle-assignment.repository";

/**
 * The READ side of vehicle ↔ driver, importable from anywhere.
 *
 * ── WHY IT IS SEPARATE FROM VehicleAssignmentModule ─────────────────────────
 * That module imports VehicleModule and DriverModule, because validating a
 * write means checking that both records exist and reusing their 404s. Which
 * means neither of them can import it back: the cycle would be real, and
 * `forwardRef` would only hide it.
 *
 * The read side needs none of that. It answers "who drives this truck today"
 * from the assignment rows alone, pulling the related record through Prisma's
 * own `include`. So it lives here, depends on nothing, and Vehicles, Drivers
 * and Trips can all import it without anything becoming circular.
 *
 * The repository is provided AND exported here rather than in both modules —
 * two providers of the same class would be two instances, which is harmless
 * today and exactly the sort of duplication that stops being harmless later.
 */
@Module({
  providers: [CurrentAssignmentService, VehicleAssignmentRepository],
  exports: [CurrentAssignmentService, VehicleAssignmentRepository],
})
export class CurrentAssignmentModule {}
