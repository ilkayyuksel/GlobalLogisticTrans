import { AUTOMATIC_CUSTOM_PROPERTY_NAME } from "../settings/pricing-settings.catalog";
import { FLAT_CUSTOM_PROPERTY_NAME } from "../trips/flat-container-rule";
import {
  isSystemManagedProperty,
  systemManagedReasonFor,
} from "./system-managed-property";

/**
 * The line between what the SYSTEM decides and what an operator decides.
 *
 * ── WHY THIS MATTERS ────────────────────────────────────────────────────────
 * Getting it wrong is expensive in both directions. Offer a system property in
 * the picker and an operator can contradict a rule, or believe a charge depends
 * on them remembering it. Hide a manual one and a real, trip-dependent charge
 * becomes impossible to record at all.
 *
 * The classification is derived from model semantics — a component link, the
 * configured automatic property, the container-type property — and never from
 * "this property has a price". These tests hold it to that.
 * ────────────────────────────────────────────────────────────────────────────
 */

const manual = (name: string) => ({ name, pricingComponentId: null });

describe("system-managed custom properties", () => {
  describe("the route-priced ones", () => {
    it.each(["Toll", "Tunnel"])(
      "%s is system-managed because it links to a pricing component",
      (name) => {
        const property = { name, pricingComponentId: "component-id" };

        expect(systemManagedReasonFor(property)).toBe("ROUTE_PRICED");
      },
    );

    /**
     * The reason names no component, so a route-priced component introduced
     * later is covered without editing the classifier.
     */
    it("classifies any linked property, whatever it is called", () => {
      expect(
        isSystemManagedProperty({
          name: "Ferry",
          pricingComponentId: "some-future-component",
        }),
      ).toBe(true);
    });
  });

  describe("the automatic pricing property", () => {
    it("TAR is system-managed", () => {
      expect(
        systemManagedReasonFor(manual(AUTOMATIC_CUSTOM_PROPERTY_NAME)),
      ).toBe("AUTOMATIC_PRICING");
    });

    it("is matched however it is cased or spaced", () => {
      expect(isSystemManagedProperty(manual("  tar  "))).toBe(true);
    });
  });

  describe("the container-type property", () => {
    it("Flat is system-managed", () => {
      expect(systemManagedReasonFor(manual(FLAT_CUSTOM_PROPERTY_NAME))).toBe(
        "CONTAINER_TYPE",
      );
    });
  });

  /**
   * ── THE MANUAL SIDE, WHICH MUST KEEP WORKING ──────────────────────────────
   * Every one of these carries a price, and none of them is automatic. A
   * classifier built on "has a price" would have refused all four.
   */
  describe("genuine per-Trip properties", () => {
    it.each([
      "Wachttijd",
      "Aan/Afkoppelen",
      "Over/EX",
      "Ashcco",
      "Weekendtoeslag",
    ])("%s stays the operator's to assign", (name) => {
      expect(systemManagedReasonFor(manual(name))).toBeNull();
      expect(isSystemManagedProperty(manual(name))).toBe(false);
    });

    it("is not decided by whether a price is configured", () => {
      expect(isSystemManagedProperty(manual("Aan/Afkoppelen"))).toBe(false);
    });
  });

  /**
   * Tarief, Brandstof, Backload and CC are pricing COMPONENTS with their own
   * calculators, not properties. Nothing in the catalog references them, so
   * there is nothing to offer — but a property somebody named after one is
   * still just a property, and this states that plainly rather than pretending
   * the classifier knows those names.
   */
  it("knows nothing about the component-only concepts", () => {
    for (const name of ["Tarief", "Brandstof", "Backload", "CC"]) {
      expect(systemManagedReasonFor(manual(name))).toBeNull();
    }
  });

  describe("robustness", () => {
    /** An absent link is no link — not a link to something unknown. */
    it("treats a missing component id as unlinked", () => {
      expect(isSystemManagedProperty({ name: "Over/EX" })).toBe(false);
    });

    it("treats a missing name as an ordinary property", () => {
      expect(
        isSystemManagedProperty({
          name: undefined as unknown as string,
          pricingComponentId: null,
        }),
      ).toBe(false);
    });
  });
});
