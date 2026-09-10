import type { CustomProperty } from "@/lib/api/types";

/**
 * Which Custom Properties the Ritten picker offers.
 *
 * ── THE RULE IS THE BACKEND'S, AND THIS PROVES THE BROWSER READS IT ─────────
 * The picker filters on `isAssignable`, a flag the API publishes, rather than
 * restating a rule about names or component links. That matters because the
 * rule is no longer the obvious one:
 *
 *   TAR      system-OWNED, and assignable. The Engine applies it automatically
 *            from a stated `tar_nummer`, and an operator may ALSO add it by
 *            hand as an extra charge — two independent amounts.
 *   Flat     system-owned, not assignable. The container type writes it.
 *   Toll     system-owned, not assignable. The route decides it.
 *   Tunnel   the same.
 *
 * `!isSystemManaged` would have got TAR wrong, which is exactly why the flag
 * exists separately.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** The catalog as the API returns it, with the backend's own classification. */
const CATALOG: readonly CustomProperty[] = [
  {
    id: "tar",
    name: "TAR",
    pricingComponentId: null,
    isSystemManaged: true,
    isAssignable: true,
  },
  {
    id: "flat",
    name: "Flat",
    pricingComponentId: null,
    isSystemManaged: true,
    isAssignable: false,
  },
  {
    id: "toll",
    name: "Toll",
    pricingComponentId: "component-toll",
    isSystemManaged: true,
    isAssignable: false,
  },
  {
    id: "tunnel",
    name: "Tunnel",
    pricingComponentId: "component-tunnel",
    isSystemManaged: true,
    isAssignable: false,
  },
  {
    id: "manual",
    name: "Aan/Afkoppelen",
    pricingComponentId: null,
    isSystemManaged: false,
    isAssignable: true,
  },
] as unknown as CustomProperty[];

/** Exactly the filter `CustomPropertiesDialog` applies. */
function offered(
  catalog: readonly CustomProperty[],
  assignedIds: ReadonlySet<string> = new Set(),
): string[] {
  return catalog
    .filter(
      (property) => !assignedIds.has(property.id) && property.isAssignable,
    )
    .map((property) => property.name);
}

describe("the Custom Property picker", () => {
  it("offers TAR, which used to be hidden", () => {
    expect(offered(CATALOG)).toContain("TAR");
  });

  it("still offers ordinary manual properties", () => {
    expect(offered(CATALOG)).toContain("Aan/Afkoppelen");
  });

  it.each(["Flat", "Toll", "Tunnel"])("still hides %s", (name) => {
    expect(offered(CATALOG)).not.toContain(name);
  });

  it("offers exactly the assignable ones", () => {
    expect(offered(CATALOG)).toEqual(["TAR", "Aan/Afkoppelen"]);
  });

  /** Already on the Trip is a separate reason to hide it, and still applies. */
  it("hides a property the Trip already carries", () => {
    expect(offered(CATALOG, new Set(["tar"]))).toEqual(["Aan/Afkoppelen"]);
  });

  /**
   * The distinction the flag exists for. Filtering on `!isSystemManaged` — the
   * rule the picker used before — would drop TAR, which is now wrong.
   */
  it("would get TAR wrong if it filtered on isSystemManaged", () => {
    const byOldRule = CATALOG.filter(
      (property) => !property.isSystemManaged,
    ).map((property) => property.name);

    expect(byOldRule).not.toContain("TAR");
    expect(offered(CATALOG)).toContain("TAR");
  });
});
