import { Injectable } from "@nestjs/common";
import { SettingValueType } from "@prisma/client";

/**
 * Checks that a stored setting value is parseable as its declared value type.
 *
 * PostgreSQL cannot enforce this: `value` is a single TEXT column that must hold
 * six different types (database_schema.md §7.2, "Application-enforced rules").
 * This validator is that enforcement.
 *
 * It returns a result rather than throwing, so it stays a pure function of its
 * inputs — trivial to unit test, and the caller decides which domain exception
 * fits the situation.
 */

export interface SettingValueValidationResult {
  valid: boolean;
  /** Present only when invalid; phrased to complete "expected INTEGER, ...". */
  reason?: string;
}

const VALID: SettingValueValidationResult = { valid: true };

function invalid(reason: string): SettingValueValidationResult {
  return { valid: false, reason };
}

const INTEGER_PATTERN = /^-?\d+$/;
const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;
/** ISO 8601 date, optionally with a time component. */
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}([T ].+)?$/;

@Injectable()
export class SettingValueValidator {
  validate(
    value: string,
    valueType: SettingValueType,
  ): SettingValueValidationResult {
    switch (valueType) {
      case "STRING":
        return VALID;
      case "INTEGER":
        return this.validateInteger(value);
      case "DECIMAL":
        return this.validateDecimal(value);
      case "BOOLEAN":
        return this.validateBoolean(value);
      case "DATE":
        return this.validateDate(value);
      case "JSON":
        return this.validateJson(value);
      default:
        // Reached only if a new value type is added to the Prisma enum without
        // a matching branch here. Failing closed is safer than accepting it.
        return invalid("no validation rule is defined for this type");
    }
  }

  private validateInteger(value: string): SettingValueValidationResult {
    if (!INTEGER_PATTERN.test(value)) {
      return invalid("value must be a whole number");
    }

    if (!Number.isSafeInteger(Number(value))) {
      return invalid("value exceeds the safe integer range");
    }

    return VALID;
  }

  private validateDecimal(value: string): SettingValueValidationResult {
    if (!DECIMAL_PATTERN.test(value)) {
      return invalid("value must be a decimal number");
    }

    if (!Number.isFinite(Number(value))) {
      return invalid("value is not a finite number");
    }

    return VALID;
  }

  /**
   * Case-insensitive because "True" from a form post is the same intent as
   * "true"; anything else is rejected rather than coerced, so a typo such as
   * "yes" fails loudly instead of silently becoming false.
   */
  private validateBoolean(value: string): SettingValueValidationResult {
    const normalized = value.trim().toLowerCase();

    return normalized === "true" || normalized === "false"
      ? VALID
      : invalid('value must be "true" or "false"');
  }

  private validateDate(value: string): SettingValueValidationResult {
    if (!ISO_DATE_PATTERN.test(value)) {
      return invalid("value must be an ISO 8601 date (YYYY-MM-DD)");
    }

    if (Number.isNaN(Date.parse(value))) {
      return invalid("value is not a real calendar date");
    }

    return this.validateCalendarDay(value);
  }

  /**
   * Date.parse silently rolls overflow forward: "2026-02-31" becomes 3 March
   * rather than failing. Rebuilding the date from its parts and comparing back
   * is what rejects days that do not exist.
   *
   * Only the calendar portion is checked, so a timezone offset that shifts the
   * UTC day (for example "2026-01-31T23:00:00-05:00") is not mistaken for an
   * invalid date.
   */
  private validateCalendarDay(value: string): SettingValueValidationResult {
    const datePart = value.split(/[T ]/)[0];
    const [year, month, day] = datePart.split("-").map(Number);
    const rebuilt = new Date(Date.UTC(year, month - 1, day));

    const matchesInput =
      rebuilt.getUTCFullYear() === year &&
      rebuilt.getUTCMonth() === month - 1 &&
      rebuilt.getUTCDate() === day;

    return matchesInput
      ? VALID
      : invalid("value is not a real calendar date");
  }

  private validateJson(value: string): SettingValueValidationResult {
    try {
      JSON.parse(value);
      return VALID;
    } catch {
      return invalid("value must be valid JSON");
    }
  }
}
