import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { MaintenanceStatus } from "@prisma/client";

/**
 * Domain exceptions for the Maintenance module.
 *
 * There is deliberately no "cannot delete" exception: maintenance records are
 * never removed, so the module exposes no delete at all. Work that should not
 * happen becomes CANCELLED, which is an ordinary update.
 */

export class MaintenanceNotFoundException extends NotFoundException {
  constructor(maintenanceId: string) {
    super(`Maintenance record "${maintenanceId}" does not exist.`);
  }
}

/**
 * The referenced Vehicle does not exist.
 *
 * Modelled as 404 for consistency with how Vehicle and Driver references are
 * reported elsewhere, rather than as a validation error: the shape of the id
 * was fine, the thing it names is not there.
 */
export class UnknownMaintenanceVehicleException extends NotFoundException {
  constructor(vehicleId: string) {
    super(`Vehicle "${vehicleId}" does not exist.`);
  }
}

/** Only planned work, or work under way, has a cycle to complete. */
export class MaintenanceNotCompletableException extends ConflictException {
  constructor(maintenanceId: string, status: MaintenanceStatus) {
    super(
      `Maintenance record "${maintenanceId}" is ${status}; only PLANNED or IN_PROGRESS maintenance can be completed.`,
    );
  }
}

/**
 * The cycle the request names is not the record's current one: another
 * completion, a new date or a new status got there first — a double submit or
 * a second open tab. Nothing was written: completing it again on stale data
 * would record one cycle twice.
 */
export class MaintenanceChangedDuringCompletionException extends ConflictException {
  constructor(maintenanceId: string) {
    super(
      `Maintenance record "${maintenanceId}" changed while it was being completed. Reload it and try again.`,
    );
  }
}

export class CompletionInFutureException extends BadRequestException {
  constructor(completedOn: string) {
    super(
      `The completion date ${completedOn} lies in the future; maintenance cannot be completed before it is done.`,
    );
  }
}
