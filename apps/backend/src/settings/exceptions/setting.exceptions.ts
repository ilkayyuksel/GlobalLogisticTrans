import { BadRequestException, NotFoundException } from "@nestjs/common";
import { SettingValueType } from "@prisma/client";

/**
 * Domain exceptions for the Settings module.
 *
 * They extend Nest's HTTP exceptions so AllExceptionsFilter renders them in the
 * standard error envelope without special-casing. The value is in the naming and
 * the message construction: call sites raise a domain concept, not an HTTP code.
 */

export class SettingNotFoundException extends NotFoundException {
  constructor(category: string, key: string) {
    super(`Setting "${key}" does not exist in category "${category}".`);
  }
}

export class InvalidSettingValueException extends BadRequestException {
  constructor(
    category: string,
    key: string,
    valueType: SettingValueType,
    reason: string,
  ) {
    super(
      `Value rejected for setting "${category}.${key}": expected ${valueType}, ${reason}.`,
    );
  }
}
