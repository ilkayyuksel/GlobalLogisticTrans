import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { CreateTripDto, TAR_NUMMER_MAX_LENGTH } from "./create-trip.dto";
import { UpdateTripDto } from "./update-trip.dto";

/**
 * TAR-nummer, through the DTOs the global ValidationPipe actually runs.
 *
 * ── WHAT THIS FIELD IS ──────────────────────────────────────────────────────
 * Free text, optional, and NOT unique: several Trips may carry the same one and
 * nothing is looked up by it. No format is enforced, deliberately — the
 * business writes whatever their counterparty gave them, and a pattern invented
 * here would reject real values.
 *
 * ── ABSENT HAS ONE REPRESENTATION ───────────────────────────────────────────
 * `""`, `"   "` and `"\t"` all mean the same thing as sending nothing: the
 * column ends up NULL. That is `trimToNull`, the same transform `internalNotes`
 * uses, and it is what keeps a blank string out of the database where it would
 * be a second way of saying "empty".
 * ────────────────────────────────────────────────────────────────────────────
 */

function transform<TDto extends object>(
  dtoClass: new () => TDto,
  payload: Record<string, unknown>,
): { errors: string[]; value: TDto } {
  const instance = plainToInstance(dtoClass, payload, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(instance, { whitelist: true }).flatMap((error) =>
    Object.keys(error.constraints ?? {}),
  );

  return { errors, value: instance };
}

describe.each([
  ["CreateTripDto", CreateTripDto as unknown as new () => object],
  ["UpdateTripDto", UpdateTripDto as unknown as new () => object],
])("tarNummer on %s", (_name, dtoClass) => {
  const tarNummerOf = (payload: Record<string, unknown>) =>
    (transform(dtoClass, payload).value as { tarNummer?: string | null })
      .tarNummer;

  it("accepts free text and keeps it", () => {
    const { errors } = transform(dtoClass, { tarNummer: "TAR-2026-0042" });

    expect(errors).toEqual([]);
    expect(tarNummerOf({ tarNummer: "TAR-2026-0042" })).toBe("TAR-2026-0042");
  });

  /** No format at all: whatever the counterparty wrote is a valid TAR-nummer. */
  it.each([
    "12345",
    "tar/2026 nr 7",
    "AB-99/x",
    "nummer met spaties",
    "🚚 2026",
  ])("enforces no format on %p", (value) => {
    expect(transform(dtoClass, { tarNummer: value }).errors).toEqual([]);
    expect(tarNummerOf({ tarNummer: value })).toBe(value);
  });

  describe("whitespace-only is empty", () => {
    it.each([
      ["an empty string", ""],
      ["spaces", "   "],
      ["a tab", "\t"],
      ["a newline", "\n"],
      ["mixed whitespace", " \t \n "],
    ])("stores %s as null", (_label, value) => {
      expect(tarNummerOf({ tarNummer: value })).toBeNull();
    });

    it("does not reject them — they are cleared, not refused", () => {
      expect(transform(dtoClass, { tarNummer: "   " }).errors).toEqual([]);
    });
  });

  it("trims a real value rather than storing the padding", () => {
    expect(tarNummerOf({ tarNummer: "  TAR-7  " })).toBe("TAR-7");
  });

  it("accepts an explicit null, which clears the column", () => {
    expect(transform(dtoClass, { tarNummer: null }).errors).toEqual([]);
    expect(tarNummerOf({ tarNummer: null })).toBeNull();
  });

  /** Omitted is not the same as null: the column is left exactly as it was. */
  it("is optional", () => {
    expect(transform(dtoClass, {}).errors).toEqual([]);
    expect(tarNummerOf({})).toBeUndefined();
  });

  it("rejects a value longer than the ceiling", () => {
    expect(
      transform(dtoClass, { tarNummer: "x".repeat(TAR_NUMMER_MAX_LENGTH + 1) })
        .errors,
    ).toContain("maxLength");
  });

  it("accepts a value exactly at the ceiling", () => {
    expect(
      transform(dtoClass, { tarNummer: "x".repeat(TAR_NUMMER_MAX_LENGTH) })
        .errors,
    ).toEqual([]);
  });

  it("rejects a non-string", () => {
    expect(transform(dtoClass, { tarNummer: { nested: true } }).errors).toContain(
      "isString",
    );
  });
});
