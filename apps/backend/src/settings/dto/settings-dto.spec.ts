import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { ListSettingsQueryDto } from "./list-settings-query.dto";
import { SettingParamsDto } from "./setting-params.dto";
import { UpdateSettingDto } from "./update-setting.dto";

/**
 * Exercises the DTOs through class-validator exactly as the global
 * ValidationPipe does, so these assertions reflect real request handling.
 */
function validate<TDto extends object>(
  dtoClass: new () => TDto,
  payload: Record<string, unknown>,
): string[] {
  const instance = plainToInstance(dtoClass, payload, {
    enableImplicitConversion: true,
  });

  return validateSync(instance, { whitelist: true }).flatMap((error) =>
    Object.keys(error.constraints ?? {}),
  );
}

describe("SettingParamsDto", () => {
  it("accepts a known category and a well-formed key", () => {
    expect(
      validate(SettingParamsDto, {
        category: "PRICING",
        key: "FUEL_PERCENTAGE",
      }),
    ).toEqual([]);
  });

  it("rejects an unknown category", () => {
    expect(
      validate(SettingParamsDto, { category: "NOT_A_CATEGORY", key: "A" }),
    ).toContain("isIn");
  });

  it("rejects a lowercase category, since categories are canonical", () => {
    expect(
      validate(SettingParamsDto, { category: "pricing", key: "A" }),
    ).toContain("isIn");
  });

  it.each(["../../etc/passwd", "key with spaces", "key/slash", ""])(
    "rejects malformed key %p",
    (key) => {
      expect(validate(SettingParamsDto, { category: "PRICING", key })).toContain(
        "matches",
      );
    },
  );

  it.each(["FUEL_PERCENTAGE", "pricing.strategy", "some-key", "A1"])(
    "accepts well-formed key %p",
    (key) => {
      expect(validate(SettingParamsDto, { category: "PRICING", key })).toEqual(
        [],
      );
    },
  );
});

describe("UpdateSettingDto", () => {
  it("accepts a string value", () => {
    expect(validate(UpdateSettingDto, { value: "18" })).toEqual([]);
  });

  it("accepts an empty string, which is valid for a STRING setting", () => {
    expect(validate(UpdateSettingDto, { value: "" })).toEqual([]);
  });

  it("rejects a missing value", () => {
    expect(validate(UpdateSettingDto, {})).toContain("isString");
  });

  it("rejects a non-string value so the type validator sees consistent input", () => {
    const errors = validateSync(
      plainToInstance(UpdateSettingDto, { value: { nested: true } }),
    );

    expect(errors).toHaveLength(1);
  });
});

describe("ListSettingsQueryDto", () => {
  /**
   * Mirrors the global ValidationPipe exactly. enableImplicitConversion is the
   * critical part: without it these tests pass while production coerces
   * "false" into true.
   */
  function transformQuery(payload: Record<string, unknown>) {
    return plainToInstance(ListSettingsQueryDto, payload, {
      enableImplicitConversion: true,
      exposeDefaultValues: true,
    });
  }

  it("defaults includeInactive to false when absent", () => {
    const dto = transformQuery({});

    expect(dto.includeInactive).toBe(false);
    expect(validateSync(dto)).toEqual([]);
  });

  it('converts the string "true" to boolean true', () => {
    expect(transformQuery({ includeInactive: "true" }).includeInactive).toBe(
      true,
    );
  });

  it('converts the string "false" to boolean false, not truthy', () => {
    expect(transformQuery({ includeInactive: "false" }).includeInactive).toBe(
      false,
    );
  });

  it.each(["FALSE", "0", "no", "", "yes", "1"])(
    "treats ambiguous flag %p as false rather than guessing",
    (raw) => {
      expect(transformQuery({ includeInactive: raw }).includeInactive).toBe(
        false,
      );
    },
  );

  it("accepts a real boolean true", () => {
    expect(transformQuery({ includeInactive: true }).includeInactive).toBe(true);
  });

  it("rejects an unknown category filter", () => {
    expect(validate(ListSettingsQueryDto, { category: "NOPE" })).toContain(
      "isIn",
    );
  });

  it("accepts an omitted category filter", () => {
    expect(validate(ListSettingsQueryDto, {})).toEqual([]);
  });
});
