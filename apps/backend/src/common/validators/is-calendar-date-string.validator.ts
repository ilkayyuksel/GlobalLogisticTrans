import {
  ValidationArguments,
  ValidationOptions,
  registerDecorator,
} from "class-validator";

import { isCalendarDate } from "../dates";

/**
 * Accepts only a real calendar day in YYYY-MM-DD form.
 *
 * @IsDateString is deliberately not used: it accepts full timestamps and
 * timezone offsets, neither of which belongs in a DATE column, and it does not
 * reject impossible days such as 2026-02-31.
 */
export function IsCalendarDateString(options?: ValidationOptions) {
  return function registerIsCalendarDateString(
    target: object,
    propertyName: string,
  ): void {
    registerDecorator({
      name: "isCalendarDateString",
      target: target.constructor,
      propertyName,
      options,
      validator: {
        validate: (value: unknown) => isCalendarDate(value),
        defaultMessage: (args: ValidationArguments) =>
          `${args.property} must be a real calendar date in YYYY-MM-DD format`,
      },
    });
  };
}
