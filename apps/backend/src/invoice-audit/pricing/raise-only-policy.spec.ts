import { Prisma } from "@prisma/client";

import { decideComponent } from "./raise-only-policy";

const decimal = (value: string) => new Prisma.Decimal(value);

describe("decideComponent", () => {
  it.each([
    ["364", "370", "RAISE"],
    ["370", "370", "UNCHANGED"],
    ["334", "300", "INVOICE_HIGHER"],
    ["134.99", "135", "RAISE"],
    ["135.01", "135", "INVOICE_HIGHER"],
    ["43.044", "43.04", "UNCHANGED"],
    ["43.045", "43.04", "INVOICE_HIGHER"],
  ])("invoice %s against system %s is %s", (stated, expected, decision) => {
    expect(decideComponent(decimal(stated), decimal(expected))).toBe(decision);
  });

  it("reads an empty cell as zero", () => {
    expect(decideComponent(null, decimal("36.20"))).toBe("RAISE");
    expect(decideComponent(null, decimal("0"))).toBe("UNCHANGED");
  });

  it("removes only when allowed and only down to nothing", () => {
    expect(decideComponent(decimal("50"), decimal("0"), { removalAllowed: true })).toBe("REMOVE");
    expect(decideComponent(decimal("50"), decimal("0"))).toBe("INVOICE_HIGHER");
    expect(decideComponent(decimal("50"), decimal("25"), { removalAllowed: true })).toBe(
      "INVOICE_HIGHER",
    );
  });
});
