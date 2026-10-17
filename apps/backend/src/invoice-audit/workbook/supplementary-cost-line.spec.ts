import { toAmountCell } from "./invoice-amounts";
import type { InvoiceColumn } from "./invoice-columns";
import { toCcNumbers, toCostLine, type CostLineEvidence } from "./supplementary-cost-line";

/**
 * A Cost Confirmation line, recognised by its shape — the shape of week 41 R53:
 * `2026-10-06 · GLT · ANRDUB2812770 · BOUSBECQUE -> Quay 869 · EK 110 · EC 4220981`.
 */
function evidence(overrides: {
  details?: Partial<Record<InvoiceColumn, string>>;
  amounts?: Partial<Record<InvoiceColumn, unknown>>;
  remarks?: string;
} = {}): CostLineEvidence {
  return {
    details: overrides.details ?? {},
    amounts: Object.fromEntries(
      Object.entries(overrides.amounts ?? { ek: 110 }).map(([column, value]) => [
        column,
        toAmountCell(value),
      ]),
    ),
    remarks: overrides.remarks ?? "EC 4220981",
  };
}

describe("toCostLine", () => {
  it("recognises the week 41 R53 shape", () => {
    expect(toCostLine(evidence())).toEqual({ ccNumbers: ["4220981"] });
  });

  it("is not one when the row states a transport's own details", () => {
    expect(toCostLine(evidence({ details: { time: "08:00" } }))).toBeNull();
    expect(toCostLine(evidence({ details: { containerType: "45PH" } }))).toBeNull();
    expect(toCostLine(evidence({ details: { startPoint: "RELEASE BEQ869" } }))).toBeNull();
    expect(toCostLine(evidence({ details: { route: "BE-Q869,BE-90000000" } }))).toBeNull();
  });

  it("is not one when it charges anything but the EK", () => {
    expect(toCostLine(evidence({ amounts: { ek: 110, tarief: 229 } }))).toBeNull();
    expect(toCostLine(evidence({ amounts: { ek: 110, others: 20 } }))).toBeNull();
  });

  it("allows an empty or zero amount beside the EK", () => {
    expect(toCostLine(evidence({ amounts: { ek: 110, tarief: null, tunnel: 0 } }))).not.toBeNull();
  });

  it("is not one without an EK or without an EC number", () => {
    expect(toCostLine(evidence({ amounts: {} }))).toBeNull();
    expect(toCostLine(evidence({ remarks: "tar" }))).toBeNull();
  });
});

describe("toCcNumbers", () => {
  it("reads every EC part of Remarks, each once", () => {
    expect(toCcNumbers("tar,EC 4220979")).toEqual(["4220979"]);
    expect(toCcNumbers("flat,tar,EC 4157219,EC4157220 ")).toEqual(["4157219", "4157220"]);
    expect(toCcNumbers("EC 1,EC 1")).toEqual(["1"]);
  });

  it("does not read a number inside other words", () => {
    expect(toCcNumbers("tar 1742 EN OP 1742")).toEqual([]);
    expect(toCcNumbers("wachtuur 13u tot 15,30")).toEqual([]);
  });
});
