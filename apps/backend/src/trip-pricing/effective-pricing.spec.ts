import { Prisma } from "@prisma/client";

import {
  EffectiveComponent,
  PricingAmountSource,
  isOverridableComponent,
  resolveEffectivePricing,
  type EngineAmount,
  type OverrideAmount,
} from "./effective-pricing";

/**
 * The effective breakdown — the one place Others, EK and Totaal are decided.
 *
 * ── WHAT THESE TESTS DEFEND ─────────────────────────────────────────────────
 * Four consumers will read this result: the Ritten columns, the Trip detail
 * panel and both Excel exports. If any of them recomputed Others or the Total
 * for itself, the two figures would eventually differ — and a Trip showing two
 * different totals is the kind of defect that ends in a wrong invoice.
 *
 * The second property is that a manual correction survives. Recalculation
 * deletes and recreates every engine item; an override must be unaffected by
 * that, and must win wherever it exists.
 */
function euro(amount: string): Prisma.Decimal {
  return new Prisma.Decimal(amount);
}

function engine(componentCode: string, amount: string): EngineAmount {
  return {
    componentCode,
    amount: euro(amount),
    customPropertyId: null,
    description: componentCode,
  };
}

function override(componentCode: string, amount: string): OverrideAmount {
  return { componentCode, amount: euro(amount) };
}

/** The worked example from the specification. */
const FULL_TRIP: EngineAmount[] = [
  engine(EffectiveComponent.BASE_PRICE, "500.00"),
  engine(EffectiveComponent.FUEL_SURCHARGE, "100.00"),
  engine(EffectiveComponent.COMBINATION, "25.00"),
  engine(EffectiveComponent.TOLL, "40.00"),
  engine(EffectiveComponent.TUNNEL, "15.00"),
  engine(EffectiveComponent.WAITING_TIME, "41.25"),
  engine(EffectiveComponent.CUSTOM_PROPERTY, "80.00"),
  engine(EffectiveComponent.COST_CONFIRMATION, "27.50"),
];

describe("resolving the effective pricing of a Trip", () => {
  describe("the components a screen shows", () => {
    it("maps each catalog code to its column", () => {
      const pricing = resolveEffectivePricing(FULL_TRIP, []);

      expect(pricing.tarief.toFixed(2)).toBe("500.00");
      expect(pricing.brandstof.toFixed(2)).toBe("100.00");
      expect(pricing.backload.toFixed(2)).toBe("25.00");
      expect(pricing.tol.toFixed(2)).toBe("40.00");
      expect(pricing.tunnel.toFixed(2)).toBe("15.00");
    });

    /** A Trip the Engine produced no toll for shows nothing, not a wrong sum. */
    it("treats an absent component as zero in the total", () => {
      const pricing = resolveEffectivePricing(
        [engine(EffectiveComponent.BASE_PRICE, "500.00")],
        [],
      );

      expect(pricing.tol.toFixed(2)).toBe("0.00");
      expect(pricing.totaal.toFixed(2)).toBe("500.00");
    });
  });

  describe("Others", () => {
    /** The rule, in one test: Others is waiting time plus custom properties. */
    it("is Waiting Time plus Custom Properties", () => {
      const pricing = resolveEffectivePricing(FULL_TRIP, []);

      expect(pricing.others.toFixed(2)).toBe("121.25");
    });

    it("is only the waiting time when no property is priced", () => {
      const pricing = resolveEffectivePricing(
        [engine(EffectiveComponent.WAITING_TIME, "41.25")],
        [],
      );

      expect(pricing.others.toFixed(2)).toBe("41.25");
    });

    /** Several priced properties are one Others, not several. */
    it("sums every Custom Property line", () => {
      const pricing = resolveEffectivePricing(
        [
          engine(EffectiveComponent.CUSTOM_PROPERTY, "80.00"),
          engine(EffectiveComponent.CUSTOM_PROPERTY, "35.00"),
        ],
        [],
      );

      expect(pricing.others.toFixed(2)).toBe("115.00");
    });

    it("is zero when the Trip has neither", () => {
      const pricing = resolveEffectivePricing(
        [engine(EffectiveComponent.BASE_PRICE, "500.00")],
        [],
      );

      expect(pricing.others.toFixed(2)).toBe("0.00");
    });

    /** Others is a grouping, so there is no code an operator could override. */
    it("is not itself an overridable component", () => {
      expect(isOverridableComponent("OTHERS")).toBe(false);
      expect(isOverridableComponent("TOTAAL")).toBe(false);
    });

    /**
     * TAR is an ordinary Custom Property, so it reaches Others through the
     * CUSTOM_PROPERTY component and is counted exactly once.
     */
    it("counts TAR through Custom Properties, once", () => {
      const pricing = resolveEffectivePricing(
        [
          // TAR 20 + Flat 80, as two lines of the same component.
          engine(EffectiveComponent.CUSTOM_PROPERTY, "20.00"),
          engine(EffectiveComponent.CUSTOM_PROPERTY, "80.00"),
          engine(EffectiveComponent.WAITING_TIME, "30.00"),
        ],
        [],
      );

      expect(pricing.others.toFixed(2)).toBe("130.00");
      expect(pricing.tarief.toFixed(2)).toBe("0.00");
    });

    it("follows the waiting-time override rather than the engine figure", () => {
      const pricing = resolveEffectivePricing(FULL_TRIP, [
        override(EffectiveComponent.WAITING_TIME, "55.00"),
      ]);

      // 55.00 + 80.00 — the corrected wait, the calculated property.
      expect(pricing.others.toFixed(2)).toBe("135.00");
    });
  });

  describe("EK", () => {
    it("is the Cost Confirmation amount", () => {
      const pricing = resolveEffectivePricing(FULL_TRIP, []);

      expect(pricing.ek.toFixed(2)).toBe("27.50");
    });

    it("is zero when the Trip has no confirmation", () => {
      const pricing = resolveEffectivePricing(
        [engine(EffectiveComponent.BASE_PRICE, "500.00")],
        [],
      );

      expect(pricing.ek.toFixed(2)).toBe("0.00");
    });

    /** The approved rule: an EK override is authoritative over the CC. */
    it("follows an override over the confirmation", () => {
      const pricing = resolveEffectivePricing(FULL_TRIP, [
        override(EffectiveComponent.COST_CONFIRMATION, "150.00"),
      ]);

      expect(pricing.ek.toFixed(2)).toBe("150.00");
    });

    /** The confirmation stays readable beside it — evidence, not erased. */
    it("still reports the engine amount the override replaced", () => {
      const pricing = resolveEffectivePricing(FULL_TRIP, [
        override(EffectiveComponent.COST_CONFIRMATION, "150.00"),
      ]);

      const ek = pricing.components.find(
        (component) =>
          component.componentCode === EffectiveComponent.COST_CONFIRMATION,
      );

      expect(ek?.engineAmount?.toFixed(2)).toBe("27.50");
      expect(ek?.effectiveAmount.toFixed(2)).toBe("150.00");
      expect(ek?.source).toBe(PricingAmountSource.OVERRIDE);
    });

    it("never puts the confirmation into Others", () => {
      const pricing = resolveEffectivePricing(FULL_TRIP, []);

      expect(pricing.others.toFixed(2)).toBe("121.25");
      expect(pricing.others.toFixed(2)).not.toBe("148.75");
    });
  });

  describe("Brandstof", () => {
    /** The worked example: Tarief 100 at 15% is 15. */
    const AT_FIFTEEN_PERCENT: EngineAmount[] = [
      engine(EffectiveComponent.BASE_PRICE, "100.00"),
      engine(EffectiveComponent.FUEL_SURCHARGE, "15.00"),
    ];

    it("is the engine figure when nobody corrected the Tarief", () => {
      const pricing = resolveEffectivePricing(AT_FIFTEEN_PERCENT, []);

      expect(pricing.brandstof.toFixed(2)).toBe("15.00");
    });

    /** Fuel follows the EFFECTIVE Tarief: 120 at the same 15% is 18. */
    it("follows a corrected Tarief", () => {
      const pricing = resolveEffectivePricing(AT_FIFTEEN_PERCENT, [
        override(EffectiveComponent.BASE_PRICE, "120.00"),
      ]);

      expect(pricing.tarief.toFixed(2)).toBe("120.00");
      expect(pricing.brandstof.toFixed(2)).toBe("18.00");
    });

    it("doubles when the Tarief doubles", () => {
      const pricing = resolveEffectivePricing(AT_FIFTEEN_PERCENT, [
        override(EffectiveComponent.BASE_PRICE, "200.00"),
      ]);

      expect(pricing.brandstof.toFixed(2)).toBe("30.00");
    });

    /**
     * ── THE HISTORICAL GUARANTEE ──────────────────────────────────────────
     * The rate comes from the SNAPSHOT — engineFuel ÷ engineTarief — not from
     * the current setting. So a Trip priced at 15% keeps 15% even after an
     * administrator moves the global percentage, which is what makes a closed
     * Trip historical. Only a reprocess writes a new snapshot and a new rate.
     */
    it("uses the rate the Trip was priced at, not today's setting", () => {
      // Two snapshots of the same Tarief, priced at different rates.
      const atFifteen = resolveEffectivePricing(AT_FIFTEEN_PERCENT, [
        override(EffectiveComponent.BASE_PRICE, "120.00"),
      ]);
      const atTwenty = resolveEffectivePricing(
        [
          engine(EffectiveComponent.BASE_PRICE, "100.00"),
          engine(EffectiveComponent.FUEL_SURCHARGE, "20.00"),
        ],
        [override(EffectiveComponent.BASE_PRICE, "120.00")],
      );

      expect(atFifteen.brandstof.toFixed(2)).toBe("18.00");
      expect(atTwenty.brandstof.toFixed(2)).toBe("24.00");
    });

    /** TAR is a Custom Property in Others; it is not a basis for fuel. */
    it("ignores TAR entirely", () => {
      const pricing = resolveEffectivePricing(
        [...AT_FIFTEEN_PERCENT, engine(EffectiveComponent.CUSTOM_PROPERTY, "20.00")],
        [],
      );

      expect(pricing.brandstof.toFixed(2)).toBe("15.00");
      expect(pricing.others.toFixed(2)).toBe("20.00");
    });

    it("is zero when the engine charged no fuel", () => {
      const pricing = resolveEffectivePricing(
        [engine(EffectiveComponent.BASE_PRICE, "100.00")],
        [override(EffectiveComponent.BASE_PRICE, "120.00")],
      );

      expect(pricing.brandstof.toFixed(2)).toBe("0.00");
    });

    /** No basis to derive a rate from: the stored figure stands. */
    it("keeps the engine figure when the engine Tarief was zero", () => {
      const pricing = resolveEffectivePricing(
        [
          engine(EffectiveComponent.BASE_PRICE, "0.00"),
          engine(EffectiveComponent.FUEL_SURCHARGE, "5.00"),
        ],
        [override(EffectiveComponent.BASE_PRICE, "120.00")],
      );

      expect(pricing.brandstof.toFixed(2)).toBe("5.00");
    });

    it("carries the corrected fuel into the Total", () => {
      const pricing = resolveEffectivePricing(AT_FIFTEEN_PERCENT, [
        override(EffectiveComponent.BASE_PRICE, "120.00"),
      ]);

      // 120 + 18
      expect(pricing.totaal.toFixed(2)).toBe("138.00");
    });
  });

  describe("Totaal", () => {
    it("is the sum of the seven columns", () => {
      const pricing = resolveEffectivePricing(FULL_TRIP, []);

      // 500 + 100 + 25 + 40 + 15 + 121.25 + 27.50
      expect(pricing.totaal.toFixed(2)).toBe("828.75");
    });

    it("moves when a dynamic component moves", () => {
      const before = resolveEffectivePricing(FULL_TRIP, []);
      const after = resolveEffectivePricing(
        FULL_TRIP.map((line) =>
          line.componentCode === EffectiveComponent.WAITING_TIME
            ? engine(EffectiveComponent.WAITING_TIME, "80.00")
            : line,
        ),
        [],
      );

      expect(before.totaal.toFixed(2)).toBe("828.75");
      expect(after.totaal.toFixed(2)).toBe("867.50");
    });

    /**
     * Correcting the Tarief moves the fuel with it: the snapshot priced 100 of
     * fuel on 500 of Tarief, so 525 carries 105. The Total therefore rises by
     * 25 AND by 5, not by 25 alone.
     */
    it("moves when a fixed component is overridden", () => {
      const pricing = resolveEffectivePricing(FULL_TRIP, [
        override(EffectiveComponent.BASE_PRICE, "525.00"),
      ]);

      expect(pricing.brandstof.toFixed(2)).toBe("105.00");
      expect(pricing.totaal.toFixed(2)).toBe("858.75");
    });

    it("moves when EK is overridden", () => {
      const pricing = resolveEffectivePricing(FULL_TRIP, [
        override(EffectiveComponent.COST_CONFIRMATION, "150.00"),
      ]);

      expect(pricing.totaal.toFixed(2)).toBe("951.25");
    });

    /** Decimal throughout: a float would make this 828.7500000000001. */
    it("adds exactly", () => {
      const pricing = resolveEffectivePricing(
        [
          engine(EffectiveComponent.BASE_PRICE, "0.10"),
          engine(EffectiveComponent.TOLL, "0.20"),
        ],
        [],
      );

      expect(pricing.totaal.toFixed(2)).toBe("0.30");
    });
  });

  describe("overrides", () => {
    /** The specification's worked example, end to end. */
    it("keeps a fixed override while a dynamic component changes", () => {
      const pricing = resolveEffectivePricing(
        [
          engine(EffectiveComponent.BASE_PRICE, "500.00"),
          engine(EffectiveComponent.FUEL_SURCHARGE, "100.00"),
          engine(EffectiveComponent.WAITING_TIME, "80.00"),
        ],
        [override(EffectiveComponent.BASE_PRICE, "525.00")],
      );

      expect(pricing.tarief.toFixed(2)).toBe("525.00");
      // 100 of fuel on 500 of Tarief is 20%, so 525 carries 105.
      expect(pricing.brandstof.toFixed(2)).toBe("105.00");
      expect(pricing.others.toFixed(2)).toBe("80.00");
      expect(pricing.totaal.toFixed(2)).toBe("710.00");
    });

    it("reports where each amount came from", () => {
      const pricing = resolveEffectivePricing(FULL_TRIP, [
        override(EffectiveComponent.TOLL, "45.00"),
      ]);

      const byCode = new Map(
        pricing.components.map((component) => [
          component.componentCode,
          component.source,
        ]),
      );

      expect(byCode.get(EffectiveComponent.TOLL)).toBe(
        PricingAmountSource.OVERRIDE,
      );
      expect(byCode.get(EffectiveComponent.BASE_PRICE)).toBe(
        PricingAmountSource.ENGINE,
      );
    });

    /**
     * An operator adding a charge the rules produced no line for. The override
     * is still effective — otherwise a correction could only ever adjust a
     * figure that already existed.
     */
    it("applies an override for a component the engine did not produce", () => {
      const pricing = resolveEffectivePricing(
        [engine(EffectiveComponent.BASE_PRICE, "500.00")],
        [override(EffectiveComponent.TUNNEL, "15.00")],
      );

      const tunnel = pricing.components.find(
        (component) => component.componentCode === EffectiveComponent.TUNNEL,
      );

      expect(tunnel?.engineAmount).toBeNull();
      expect(pricing.tunnel.toFixed(2)).toBe("15.00");
      expect(pricing.totaal.toFixed(2)).toBe("515.00");
    });

    /** A Trip nobody has corrected reads exactly as it did before. */
    it("changes nothing when there are no overrides", () => {
      const pricing = resolveEffectivePricing(FULL_TRIP, []);

      expect(
        pricing.components.every(
          (component) => component.source === PricingAmountSource.ENGINE,
        ),
      ).toBe(true);
      expect(pricing.totaal.toFixed(2)).toBe("828.75");
    });

    /**
     * Exactly three amounts an operator may type — Tarief, Toll and Tunnel.
     * Enforced HERE and not only in the UI, so no request can store an override
     * the model would then have to explain.
     */
    it.each([
      EffectiveComponent.BASE_PRICE,
      EffectiveComponent.TOLL,
      EffectiveComponent.TUNNEL,
    ])("allows %s to be overridden", (componentCode) => {
      expect(isOverridableComponent(componentCode)).toBe(true);
    });

    /**
     * Every one of these is DERIVED from something the operator can already
     * change, so an override would be a second, competing answer. EK in
     * particular: its amount belongs to the Cost Confirmation, and a figure
     * typed over it would have no document behind it.
     */
    it.each([
      EffectiveComponent.FUEL_SURCHARGE,
      EffectiveComponent.COMBINATION,
      EffectiveComponent.WAITING_TIME,
      EffectiveComponent.CUSTOM_PROPERTY,
      EffectiveComponent.COST_CONFIRMATION,
    ])("refuses an override of %s", (componentCode) => {
      expect(isOverridableComponent(componentCode)).toBe(false);
    });
  });
});
