import {
  ValidationArguments,
  ValidationOptions,
  registerDecorator,
} from "class-validator";

import { isClockTime } from "../time-of-day";

/**
 * Accepts only a wall-clock time in HH:MM or HH:MM:SS form.
 *
 * There is no class-validator decorator for a bare time: @IsDateString wants a
 * full timestamp, and a plain @Matches would report the raw pattern instead of
 * something an administrator can act on.
 */
export function IsClockTimeString(options?: ValidationOptions) {
  return function registerIsClockTimeString(
    target: object,
    propertyName: string,
  ): void {
    registerDecorator({
      name: "isClockTimeString",
      target: target.constructor,
      propertyName,
      options,
      validator: {
        validate: (value: unknown) => isClockTime(value),
        defaultMessage: (args: ValidationArguments) =>
          `${args.property} must be a time in HH:MM or HH:MM:SS format`,
      },
    });
  };
}
