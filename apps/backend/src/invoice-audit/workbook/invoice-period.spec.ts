import { sheetRow } from "../__fixtures__/invoice-rows";
import { toInvoicePeriod } from "./invoice-sheet";

/** The days an invoice covers: Monday to Friday of its ISO week. */
describe("toInvoicePeriod", () => {
  it("covers Monday to Friday of week 41, whatever days the lines fall on", () => {
    expect(
      toInvoicePeriod([sheetRow({ planningDate: "2026-10-06" }), sheetRow({ planningDate: "2026-10-08" })]),
    ).toEqual({ from: "2026-10-05", to: "2026-10-09" });
  });

  it("reads a Sunday as the end of its own week", () => {
    expect(toInvoicePeriod([sheetRow({ planningDate: "2026-10-11" })])).toEqual({
      from: "2026-10-05",
      to: "2026-10-09",
    });
  });

  it("names no week when the lines fall in two", () => {
    expect(
      toInvoicePeriod([sheetRow({ planningDate: "2026-10-09" }), sheetRow({ planningDate: "2026-10-12" })]),
    ).toBeNull();
  });

  it("reads the week from the transports, not from Cost Confirmation lines", () => {
    expect(
      toInvoicePeriod([
        sheetRow({ planningDate: "2026-10-06" }),
        sheetRow({ planningDate: "2026-09-28", costLine: { ccNumbers: ["4220981"] } }),
      ]),
    ).toEqual({ from: "2026-10-05", to: "2026-10-09" });
  });

  it("names no week without a transport line", () => {
    expect(toInvoicePeriod([])).toBeNull();
  });
});
