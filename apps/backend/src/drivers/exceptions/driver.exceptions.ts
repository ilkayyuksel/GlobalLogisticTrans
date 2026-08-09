import { ConflictException, NotFoundException } from "@nestjs/common";

/**
 * Domain exceptions for the Driver module.
 *
 * They extend Nest's HTTP exceptions so AllExceptionsFilter renders them in the
 * standard envelope without special-casing, while call sites still raise a
 * domain concept rather than a status code.
 *
 * There is deliberately no "cannot delete" exception: drivers are never
 * physically deleted, so the module exposes no delete operation at all.
 */

export class DriverNotFoundException extends NotFoundException {
  constructor(driverId: string) {
    super(`Driver "${driverId}" does not exist.`);
  }
}

export class DriverLicenceNumberConflictException extends ConflictException {
  constructor(licenceNumber: string) {
    super(
      `Licence number "${licenceNumber}" is already used by another active driver.`,
    );
  }
}
