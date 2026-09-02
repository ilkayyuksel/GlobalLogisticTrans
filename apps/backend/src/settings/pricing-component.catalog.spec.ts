import { PricingComponentCode } from "../pricing-engine/pricing-line";
import {
  displayOrderOf,
  PRICING_COMPONENT_CATALOG,
} from "./pricing-component.catalog";

/**
 * The catalog a fresh database must end up with.
 *
 * ── WHAT THESE TESTS ARE PROTECTING ─────────────────────────────────────────
 * Every `trip_pricing_item` carries a foreign key into `pricing_component`, so
 * a code the Engine can produce but the catalog does not hold is not a cosmetic
 * gap: the Engine calculates the Trip correctly and then cannot store the
 * result. That is exactly how a deployed database came to answer `pricing:
 * null` for all 49 of its Trips.
 * ────────────────────────────────────────────────────────────────────────────
 */
describe("the pricing component catalog", () => {
  /**
   * The binding that matters. A step added to the Engine with a new code, and
   * forgotten here, would fail at the moment its first breakdown is written —
   * in production, on a real Trip, with the calculation already done.
   */
  it("holds every code the Pricing Engine can produce", () => {
    const catalogued = PRICING_COMPONENT_CATALOG.map(
      (component) => component.code,
    );

    for (const code of Object.values(PricingComponentCode)) {
      expect(catalogued).toContain(code);
    }
  });

  /**
   * The Engine's list is deliberately SHORTER than the catalog: no step
   * produces MANUAL_ADJUSTMENT yet, and listing it as producible would suggest
   * it is supported. The catalog still needs it, because an Administrator's
   * manual adjustment is stored as an item classified by it.
   */
  it("also holds the one code no Engine step produces yet", () => {
    const catalogued = PRICING_COMPONENT_CATALOG.map(
      (component) => component.code,
    );

    expect(catalogued).toContain("MANUAL_ADJUSTMENT");
    expect(Object.values(PricingComponentCode)).not.toContain(
      "MANUAL_ADJUSTMENT",
    );
  });

  /** database_schema.md §8.2, transcribed rather than invented. */
  it("is exactly the nine components the schema requires", () => {
    expect(PRICING_COMPONENT_CATALOG.map((component) => component.code)).toEqual(
      [
        "BASE_PRICE",
        "COMBINATION",
        "FUEL_SURCHARGE",
        "WAITING_TIME",
        "TOLL",
        "TUNNEL",
        "CUSTOM_PROPERTY",
        "MANUAL_ADJUSTMENT",
        "COST_CONFIRMATION",
      ],
    );
  });

  it("carries a name and a description for every component", () => {
    for (const component of PRICING_COMPONENT_CATALOG) {
      expect(component.name.length).toBeGreaterThan(0);
      expect(component.description.length).toBeGreaterThan(0);
    }
  });

  it("names no code twice", () => {
    const codes = PRICING_COMPONENT_CATALOG.map((component) => component.code);

    expect(new Set(codes).size).toBe(codes.length);
  });

  /**
   * The array order is the calculation order from pricing_rules.md, and the
   * stored position is derived from it so the two cannot disagree. Positions
   * start at 1 to read the same as the numbered list in that document.
   */
  describe("display order", () => {
    it("starts at one and follows the array", () => {
      expect(displayOrderOf("BASE_PRICE")).toBe(1);
      expect(displayOrderOf("COMBINATION")).toBe(2);
      expect(displayOrderOf("COST_CONFIRMATION")).toBe(
        PRICING_COMPONENT_CATALOG.length,
      );
    });

    it("gives every component a distinct position", () => {
      const positions = PRICING_COMPONENT_CATALOG.map((component) =>
        displayOrderOf(component.code),
      );

      expect(new Set(positions).size).toBe(positions.length);
    });
  });
});
