/**
 * The `pricing_component` catalog every environment must have.
 *
 * ── WHY THIS EXISTS IN THE BACKEND AT ALL ───────────────────────────────────
 * These rows were owned by `prisma/seed.ts`, which is idempotent and correct —
 * but which the deployment never runs. The compose stack runs `migrate deploy`
 * and nothing else, and `prisma db seed` executes `tsx prisma/seed.ts` while
 * `tsx` is a devDependency that `pnpm install --prod` removes from the runtime
 * image. A freshly deployed database therefore had migrations, no catalog, and
 * no way to get one from inside the application.
 *
 * The consequence was not a missing row somewhere harmless. Every pricing item
 * carries a foreign key into this table, so the Engine calculated a Trip
 * correctly and then failed to store it with
 *
 *   Pricing component "BASE_PRICE" is not present in the catalog
 *
 * leaving `trip_pricing` empty, the API answering `pricing: null`, and the
 * Ritten pricing columns showing "—" with nothing an operator could do about it.
 *
 * Whether the database has what the Engine requires is a Backend invariant, so
 * the Backend is where it is now ensured — by the bootstrap that already exists
 * for the settings half of the same problem.
 *
 * ── NOT A NEW LIST ──────────────────────────────────────────────────────────
 * Nothing here is invented. The codes, names, descriptions and order are taken
 * verbatim from `prisma/seed.ts`, which took them from database_schema.md §8.2.
 * The seed keeps its copy so `pnpm db:seed` still works for developers; the two
 * are bound by `pricing-component.catalog.spec.ts`, which fails if they ever
 * disagree — the same treatment `pricing-settings.catalog.ts` already gets.
 *
 * ── ORDER IS A BUSINESS RULE ────────────────────────────────────────────────
 * The array order is the calculation order from pricing_rules.md, and
 * `displayOrder` is derived from it. The Engine and the Excel export both read
 * it, so reordering this array reorders a breakdown.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** One row of the catalog, as it is created when absent. */
export interface PricingComponentDefinition {
  readonly code: string;
  readonly name: string;
  readonly description: string;
}

export const PRICING_COMPONENT_CATALOG: readonly PricingComponentDefinition[] = [
  {
    code: "BASE_PRICE",
    name: "Base Price",
    description:
      "Base transport price determined by the active pricing strategy (route-based or distance-based).",
  },
  {
    code: "COMBINATION",
    name: "Combination Surcharge",
    description:
      "Surcharge applied automatically to every Trip belonging to a Combination Trip Group.",
  },
  {
    code: "FUEL_SURCHARGE",
    name: "Fuel Surcharge",
    description:
      "Percentage calculated on the base transport price only. Never applied to any other component.",
  },
  {
    code: "WAITING_TIME",
    name: "Waiting Time",
    description:
      "Billable waiting time beyond the configured free period, charged in configurable blocks.",
  },
  {
    code: "TOLL",
    name: "Toll",
    description: "Toll costs added directly to the total.",
  },
  {
    code: "TUNNEL",
    name: "Tunnel",
    description: "Tunnel costs added directly to the total.",
  },
  {
    code: "CUSTOM_PROPERTY",
    name: "Custom Property",
    description:
      "Amount contributed by one Custom Property assigned to the Trip.",
  },
  {
    /*
     * No Engine step produces this one yet. It is still part of the catalog
     * because database_schema.md §8.2 requires it and an Administrator's manual
     * adjustment is stored as an item classified by it.
     */
    code: "MANUAL_ADJUSTMENT",
    name: "Manual Adjustment",
    description:
      "Adjustment entered manually by the Administrator, stored as its own pricing item.",
  },
  {
    code: "COST_CONFIRMATION",
    name: "Cost Confirmation",
    description:
      "The cost Eucon confirmed for this Trip, taken from its Cost Confirmation document. Presented as EK.",
  },
];

/**
 * Positions start at 1, so the stored order reads the same as the numbered list
 * in pricing_rules.md. Derived rather than typed out, so the two can never
 * disagree.
 */
export function displayOrderOf(code: string): number {
  return (
    PRICING_COMPONENT_CATALOG.findIndex(
      (component) => component.code === code,
    ) + 1
  );
}
