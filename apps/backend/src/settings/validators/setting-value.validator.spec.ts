import { SettingValueType } from "@prisma/client";

import { SettingValueValidator } from "./setting-value.validator";

describe("SettingValueValidator", () => {
  const validator = new SettingValueValidator();

  const accepted: [SettingValueType, string][] = [
    ["STRING", "Global Logistic Trans"],
    ["STRING", ""],
    ["STRING", "15"],
    ["INTEGER", "15"],
    ["INTEGER", "-3"],
    ["INTEGER", "0"],
    ["DECIMAL", "15"],
    ["DECIMAL", "15.75"],
    ["DECIMAL", "-0.5"],
    ["BOOLEAN", "true"],
    ["BOOLEAN", "false"],
    ["BOOLEAN", "TRUE"],
    ["BOOLEAN", " true "],
    ["DATE", "2026-01-31"],
    ["DATE", "2026-01-31T08:30:00Z"],
    ["DATE", "2024-02-29"],
    // A negative offset pushes this to 1 February in UTC; only the calendar
    // part is validated, so it must still be accepted.
    ["DATE", "2026-01-31T23:00:00-05:00"],
    ["JSON", '{"enabled":true}'],
    ["JSON", "[1,2,3]"],
    ["JSON", '"a string is valid json"'],
  ];

  const rejected: [SettingValueType, string][] = [
    ["INTEGER", "15.5"],
    ["INTEGER", "abc"],
    ["INTEGER", ""],
    ["INTEGER", "1e3"],
    ["INTEGER", "9007199254740993"],
    ["DECIMAL", "abc"],
    ["DECIMAL", ""],
    ["DECIMAL", "15,75"],
    ["BOOLEAN", "yes"],
    ["BOOLEAN", "1"],
    ["BOOLEAN", ""],
    ["DATE", "31-01-2026"],
    // Days that do not exist: Date.parse rolls these forward instead of failing.
    ["DATE", "2026-02-31"],
    ["DATE", "2026-04-31"],
    ["DATE", "2026-13-01"],
    ["DATE", "2026-00-10"],
    ["DATE", "2025-02-29"],
    ["DATE", "not a date"],
    ["JSON", "{invalid}"],
    ["JSON", ""],
  ];

  it.each(accepted)("accepts %s value %p", (valueType, value) => {
    expect(validator.validate(value, valueType)).toEqual({ valid: true });
  });

  it.each(rejected)("rejects %s value %p", (valueType, value) => {
    const result = validator.validate(value, valueType);

    expect(result.valid).toBe(false);
    expect(result.reason).toEqual(expect.any(String));
  });

  it("fails closed for an unrecognised value type", () => {
    const unknownType = "GEOJSON" as SettingValueType;

    expect(validator.validate("anything", unknownType).valid).toBe(false);
  });
});
