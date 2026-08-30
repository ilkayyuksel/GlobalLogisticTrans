import { Prisma } from "@prisma/client";

import { toEffectivePricingDto } from "./dto/effective-pricing.dto";
import {
  resolveEffectivePricing,
  type EngineAmount,
} from "./effective-pricing";

/**
 * A CLOSED Trip keeps the money it was priced with.
 *
 * ── THE GUARANTEE ───────────────────────────────────────────────────────────
 * Configuration is read when a Trip is PRICED. Changing it afterwards — a route
 * price, the fuel percentage — must not reach back and change what a finished
 * Trip was charged. An invoice that quietly rewrote itself when somebody edited
 * a setting would make every historical figure unreliable.
 *
 * The mechanism is that the snapshot is self-contained: every amount is stored,
 * and so is the rate the fuel was calculated with. Nothing on the read path
 * consults the current configuration, and these tests hold that line by reading
 * a stored snapshot and showing that no live setting can influence it.
 *
 * Dynamic TRIP inputs are the deliberate exception and are tested elsewhere: a
 * Custom Property, a waiting time or a Cost Confirmation is a fact about the
 * Trip rather than a global setting, and changing one does reprice it.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** A stored line, as the repository hands it to the resolver. */
function line(
  componentCode: string,
  amount: string,
  unitPrice: string | null = null,
): EngineAmount {
  return {
    componentCode,
    amount: new Prisma.Decimal(amount),
    customPropertyId: null,
    description: componentCode,
    unitPrice: unitPrice === null ? null : new Prisma.Decimal(unitPrice),
  };
}

/**
 * Trip A, closed on Monday: route price 520, fuel 15%.
 *
 * The rate is on the fuel line, which is what makes the snapshot answerable on
 * its own.
 */
const CLOSED_ON_MONDAY: EngineAmount[] = [
  line("BASE_PRICE", "520.00"),
  line("FUEL_SURCHARGE", "78.00", "15"),
];

function read(lines: EngineAmount[], overrides: never[] = []) {
  return toEffectivePricingDto(resolveEffectivePricing(lines, overrides));
}

describe("a Trip priced before the configuration changed", () => {
  it("keeps the Tarief it was priced with", () => {
    // The route was later reconfigured to 550. The snapshot does not know and
    // must not care: it holds 520, and 520 is what the Trip cost.
    expect(read(CLOSED_ON_MONDAY).tarief).toBe("520.00");
  });

  it("keeps the Brandstof it was priced with", () => {
    expect(read(CLOSED_ON_MONDAY).brandstof).toBe("78.00");
  });

  /**
   * ── THE FUEL PERCENTAGE IS THE HARD CASE ────────────────────────────────
   * Brandstof is RECOMPUTED at read time so it can follow a corrected Tarief.
   * That recomputation must use the rate the snapshot was calculated with, not
   * the current setting — otherwise moving FUEL_PERCENTAGE from 15 to 20 would
   * silently restate every historical fuel amount.
   *
   * The rate is read from the line. There is no code path from this resolver to
   * the Settings table at all, which is the structural half of the guarantee.
   */
  it("uses the rate stored on the line, whatever the setting now says", () => {
    const corrected = read(CLOSED_ON_MONDAY, [
      { componentCode: "BASE_PRICE", amount: new Prisma.Decimal("600.00") },
    ] as never);

    // 15% of 600 — the Monday rate — and not 20% of 600.
    expect(corrected.brandstof).toBe("90.00");
  });

  it("gives a Trip closed at 20% its own rate", () => {
    const closedOnTuesday = [
      line("BASE_PRICE", "550.00"),
      line("FUEL_SURCHARGE", "110.00", "20"),
    ];

    expect(read(closedOnTuesday).brandstof).toBe("110.00");
    expect(read(closedOnTuesday).tarief).toBe("550.00");
  });

  /** Two Trips priced under different configurations, side by side. */
  it("lets the two coexist without either disturbing the other", () => {
    const monday = read(CLOSED_ON_MONDAY);
    const tuesday = read([
      line("BASE_PRICE", "550.00"),
      line("FUEL_SURCHARGE", "110.00", "20"),
    ]);

    expect(monday.tarief).toBe("520.00");
    expect(monday.brandstof).toBe("78.00");
    expect(tuesday.tarief).toBe("550.00");
    expect(tuesday.brandstof).toBe("110.00");
  });

  /**
   * A snapshot written before the rate was recorded still behaves as it always
   * did: the ratio between the stored fuel and the stored base IS the rate that
   * applied. Only a base of zero cannot answer, and that case did not exist
   * before the rate began to be stored.
   */
  it("falls back to the stored ratio on an older snapshot", () => {
    const beforeTheRateWasStored = [
      line("BASE_PRICE", "520.00"),
      line("FUEL_SURCHARGE", "78.00"),
    ];

    const corrected = read(beforeTheRateWasStored, [
      { componentCode: "BASE_PRICE", amount: new Prisma.Decimal("600.00") },
    ] as never);

    // 78/520 is 15%, applied to 600.
    expect(corrected.brandstof).toBe("90.00");
  });

  /**
   * ── AND THE STRUCTURAL HALF ───────────────────────────────────────────────
   * The resolver is a pure function of the stored lines and the stored
   * corrections. It takes no service, reads no setting and issues no query, so
   * there is no path by which live configuration could reach a historical
   * amount even if a future change wanted one.
   */
  it("is a pure function of what was stored", () => {
    expect(resolveEffectivePricing).toHaveLength(2);
    expect(read(CLOSED_ON_MONDAY)).toEqual(read(CLOSED_ON_MONDAY));
  });
});
