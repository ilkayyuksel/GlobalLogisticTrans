import { TransformFnParams } from "class-transformer";

/**
 * Shared class-transformer helpers for request DTOs.
 *
 * Every helper reads the ORIGINAL request value rather than the one handed to
 * it. The global ValidationPipe runs with enableImplicitConversion, which
 * rewrites values before validators see them — Boolean("false") is true, and a
 * number is silently coerced into a string. Reading the raw value keeps the
 * validators honest.
 */

export function rawValueOf({ obj, key }: TransformFnParams): unknown {
  return (obj as Record<string, unknown>)[key];
}

/** Trims a string. Non-strings pass through so @IsString can reject them. */
export function trim(params: TransformFnParams): unknown {
  const value = rawValueOf(params);

  return typeof value === "string" ? value.trim() : value;
}

/**
 * Trims, and turns a blank string into null.
 *
 * A form that submits an empty field means "no value", not "the empty string".
 * Without this, a blank business identifier would be stored as "" and would
 * then collide with every other blank value under a unique index.
 */
export function trimToNull(params: TransformFnParams): unknown {
  const value = rawValueOf(params);

  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

/** Trims, and turns a blank string into undefined — for optional filters. */
export function trimToUndefined(params: TransformFnParams): unknown {
  const value = rawValueOf(params);

  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Optional boolean filter.
 *
 * Returns undefined when absent, so "no filter" stays distinct from
 * "false". Unrecognised values pass through untouched so @IsBoolean rejects
 * them instead of the filter silently defaulting.
 */
export function toOptionalBoolean(params: TransformFnParams): unknown {
  const value = rawValueOf(params);

  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (value === true || value === "true") {
    return true;
  }

  if (value === false || value === "false") {
    return false;
  }

  return value;
}
