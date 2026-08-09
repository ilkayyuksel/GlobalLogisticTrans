import { ConflictException, NotFoundException } from "@nestjs/common";

/**
 * Domain exceptions for the Vehicle module.
 *
 * They extend Nest's HTTP exceptions so AllExceptionsFilter renders them in the
 * standard envelope without special-casing, while call sites still raise a
 * domain concept rather than a status code.
 *
 * There is deliberately no "cannot delete" exception: vehicles are never
 * physically deleted, so the module exposes no delete operation at all.
 */

export class VehicleNotFoundException extends NotFoundException {
  constructor(vehicleId: string) {
    super(`Vehicle "${vehicleId}" does not exist.`);
  }
}

export class VehicleLicensePlateConflictException extends ConflictException {
  constructor(licensePlate: string) {
    super(
      `Licence plate "${licensePlate}" is already used by another active vehicle.`,
    );
  }
}

export class VehicleDisplayColorConflictException extends ConflictException {
  constructor(displayColor: string) {
    super(
      `Planning colour "${displayColor}" is already used by another active vehicle.`,
    );
  }
}
