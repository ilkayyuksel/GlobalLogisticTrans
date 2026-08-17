import { NotFoundException } from "@nestjs/common";

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
