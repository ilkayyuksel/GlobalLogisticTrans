import { TransformFnParams } from "class-transformer";

import { rawValueOf } from "./transforms";

/**
 * Shared hex-colour handling for display fields.
 *
 * Six digits only. Three-digit shorthand is rejected because "#fff" and
 * "#ffffff" are the same colour but different strings, which would defeat any
 * uniqueness rule and make two stored values compare unequal.
 */
export const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

export const HEX_COLOR_MESSAGE =
  "must be a six-digit hex colour, for example #2563eb";

/**
 * Canonicalises a hex colour to lowercase.
 *
 * Hex colours are case-insensitive by definition, so "#AABBCC" and "#aabbcc"
 * are the same colour. Storing one form keeps comparisons meaningful.
 *
 * Reads the raw request value so the pipe's implicit conversion cannot turn a
 * non-string into one behind the validator's back.
 */
export function toCanonicalHexColor(params: TransformFnParams): unknown {
  const value = rawValueOf(params);

  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed.toLowerCase() : null;
}
