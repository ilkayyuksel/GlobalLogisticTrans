import type { Trip } from "@/lib/api/types";

import { toAddressFormValues, toChangedAddressPayload } from "./address-payload";

const TRIP = {
  terminal: "PSA Antwerp",
  destinationCity: "Dourges",
  destinationCountry: "France",
} as Trip;

/**
 * Only a CHANGED address field is sent: the terminal and the city are pricing
 * inputs, and an unchanged one travelling along would reprice a CLOSED Trip.
 */
describe("the address an edit sends", () => {
  it("sends nothing when nothing changed", () => {
    expect(toChangedAddressPayload(toAddressFormValues(TRIP), TRIP)).toEqual({});
  });

  it("treats surrounding whitespace as unchanged", () => {
    expect(
      toChangedAddressPayload(
        { terminal: "  PSA Antwerp ", destinationCity: "Dourges", destinationCountry: "France" },
        TRIP,
      ),
    ).toEqual({});
  });

  it("sends each changed field, trimmed, and nothing else", () => {
    expect(
      toChangedAddressPayload(
        { terminal: " Quay 1742 ", destinationCity: "Dourges", destinationCountry: "France" },
        TRIP,
      ),
    ).toEqual({ terminal: "Quay 1742" });
  });

  it("sends null for an emptied field", () => {
    expect(
      toChangedAddressPayload(
        { terminal: "PSA Antwerp", destinationCity: "Dourges", destinationCountry: "   " },
        TRIP,
      ),
    ).toEqual({ destinationCountry: null });
  });

  it("fills in an address the Trip did not have", () => {
    const empty = { terminal: null, destinationCity: null, destinationCountry: null } as Trip;

    expect(
      toChangedAddressPayload(
        { terminal: "", destinationCity: "Tielt", destinationCountry: "" },
        empty,
      ),
    ).toEqual({ destinationCity: "Tielt" });
  });
});
