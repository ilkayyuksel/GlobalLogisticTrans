import { ConflictException, NotFoundException } from "@nestjs/common";

/**
 * Domain exceptions for the CustomProperty module.
 *
 * They extend Nest's HTTP exceptions so AllExceptionsFilter renders them in the
 * standard envelope without special-casing, while call sites still raise a
 * domain concept rather than a status code.
 *
 * There is deliberately no "cannot delete" exception: properties are never
 * physically deleted, so the module exposes no delete operation at all.
 */

export class CustomPropertyNotFoundException extends NotFoundException {
  constructor(customPropertyId: string) {
    super(`Custom property "${customPropertyId}" does not exist.`);
  }
}

export class DuplicateCustomPropertyNameException extends ConflictException {
  constructor(name: string) {
    super(`An active custom property named "${name}" already exists.`);
  }
}
