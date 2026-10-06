import type { PricingSnapshot } from "@/lib/api/types";

import { toPricedTripLines } from "./pricing-lines";

/**
 * Over ST in the exports: read, never calculated.
 *
 * The Engine writes Leg 2's Over ST as lines of their own under the existing
 * components (BASE_PRICE, TOLL, TUNNEL), described "Over ST". An export reads
 * the stored lines per component, so Tarief, Toll and Tunnel come out as Leg 2's
 * effective amounts — and nothing here adds Over ST a second time.
 */
function item(code: string, amount: string, description = code) {
  return {
    id: `item-${code}-${description}`,
    tripPricingId: "snapshot-1",
    pricingComponentId: `component-${code}`,
    pricingComponentCode: code,
    customPropertyId: null,
    description,
    amount,
    currency: "EUR",
    calculationOrder: 1,
    quantity: null,
    unitPrice: null,
  };
}

const LEG_2 = {
  pricing: { tripId: "leg-2" },
  items: [
    item("BASE_PRICE", "80.00", "GENT - LESSINES"),
    item("BASE_PRICE", "50.00", "Over ST"),
    item("COMBINATION", "50.00"),
    item("FUEL_SURCHARGE", "19.50"),
    item("TOLL", "15.00", "Toll"),
    item("TOLL", "10.00", "Over ST"),
    item("TUNNEL", "5.00", "Tunnel"),
    item("TUNNEL", "3.00", "Over ST"),
  ],
} as unknown as PricingSnapshot;

describe("Over ST in an exported row", () => {
  it("reads Leg 2's effective Tarief, Toll and Tunnel from the stored lines", () => {
    const lines = toPricedTripLines(LEG_2);

    expect(lines.basePrice).toBe(130);
    expect(lines.toll).toBe(25);
    expect(lines.tunnel).toBe(8);
  });

  it("keeps the Backload on its own, never as Over ST", () => {
    expect(toPricedTripLines(LEG_2).combination).toBe(50);
  });

  it("adds nothing for Over ST beyond the stored lines", () => {
    const lines = toPricedTripLines(LEG_2);
    const sum =
      (lines.basePrice ?? 0) +
      (lines.combination ?? 0) +
      (lines.fuel ?? 0) +
      (lines.toll ?? 0) +
      (lines.tunnel ?? 0);

    // 130 + 50 + 19.50 + 25 + 8, exactly what the Engine stored.
    expect(sum).toBe(232.5);
  });
});

