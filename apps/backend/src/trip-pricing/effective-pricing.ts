import { Prisma } from "@prisma/client";

/**
 * What a Trip is worth, after the operator has had their say.
 *
 * ── THE ONE PLACE THIS IS DECIDED ───────────────────────────────────────────
 * Four screens ask this question — the Ritten pricing columns, the Trip detail
 * panel, the Prijsoverzicht export and the Basis export — and they must all get
 * the same answer. So the grouping and the arithmetic live here, once, and the
 * consumers select from the result rather than recomputing it. A second copy of
 * "Others is waiting time plus custom properties" would eventually disagree
 * with this one, and disagreeing about money is the expensive kind.
 *
 * ── ENGINE VALUE AND OPERATOR VALUE ARE BOTH KEPT ───────────────────────────
 * An override does not erase what the rules produced; it sits beside it. Both
 * travel in the result so a screen can show the effective figure and still
 * explain where it differs from the calculation — which is what makes a manual
 * correction auditable rather than merely applied.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Where an effective amount came from. */
export const PricingAmountSource = {
  ENGINE: "ENGINE",
  OVERRIDE: "OVERRIDE",
} as const;

export type PricingAmountSource =
  (typeof PricingAmountSource)[keyof typeof PricingAmountSource];

/**
 * The component codes the presentation groups by.
 *
 * Deliberately the catalog's own codes rather than the Dutch column names: the
 * grouping below turns codes into Tarief/Others/EK, and doing it in one
 * direction only keeps the vocabulary of the data separate from the vocabulary
 * of the screen.
 */
export const EffectiveComponent = {
  BASE_PRICE: "BASE_PRICE",
  FUEL_SURCHARGE: "FUEL_SURCHARGE",
  COMBINATION: "COMBINATION",
  TOLL: "TOLL",
  TUNNEL: "TUNNEL",
  WAITING_TIME: "WAITING_TIME",
  CUSTOM_PROPERTY: "CUSTOM_PROPERTY",
  COST_CONFIRMATION: "COST_CONFIRMATION",
} as const;

export type EffectiveComponent =
  (typeof EffectiveComponent)[keyof typeof EffectiveComponent];

/**
 * The two components that make up Others.
 *
 * Named here rather than spelled out at each use, because "Others is waiting
 * time plus custom properties" is a business rule and it should appear once.
 */
const OTHERS_COMPONENTS: readonly string[] = [
  EffectiveComponent.WAITING_TIME,
  EffectiveComponent.CUSTOM_PROPERTY,
];

/** One engine line, as this layer needs it. */
export interface EngineAmount {
  readonly componentCode: string;
  readonly amount: Prisma.Decimal;
  /** Set only on a Custom Property line — which property produced the charge. */
  readonly customPropertyId: string | null;
  readonly description: string;
}

/** One operator correction. */
export interface OverrideAmount {
  readonly componentCode: string;
  readonly amount: Prisma.Decimal;
}

/**
 * One component, as a screen shows it.
 *
 * `engineAmount` is null for a component the Engine produced no line for — a
 * Trip with no toll, for instance. An override on such a component is still
 * effective: an operator adding a charge the rules did not produce is a
 * correction like any other.
 */
export interface EffectiveAmount {
  readonly componentCode: string;
  readonly engineAmount: Prisma.Decimal | null;
  readonly effectiveAmount: Prisma.Decimal;
  readonly source: PricingAmountSource;
}

/**
 * The whole breakdown, grouped the way the screens read it.
 *
 * Others and EK are DERIVED here and are not overridable: Others is a sum of
 * two calculated components, and correcting it means correcting one of them.
 * Totaal is likewise always a sum — there is no figure an operator could type
 * that would not immediately be contradicted by its own parts.
 */
export interface EffectivePricing {
  /** Every component with an effective amount, in catalog order. */
  readonly components: readonly EffectiveAmount[];

  readonly tarief: Prisma.Decimal;
  readonly brandstof: Prisma.Decimal;
  readonly backload: Prisma.Decimal;
  readonly tol: Prisma.Decimal;
  readonly tunnel: Prisma.Decimal;
  /** Waiting Time + Custom Properties. Calculated, never overridable. */
  readonly others: Prisma.Decimal;
  /** The Cost Confirmation, or its override. */
  readonly ek: Prisma.Decimal;
  /** The sum of the seven above. Never stored as an independent figure. */
  readonly totaal: Prisma.Decimal;
}

const ZERO = new Prisma.Decimal(0);

/**
 * The fuel surcharge, following the EFFECTIVE Tarief.
 *
 * ── WHY IT IS RECOMPUTED HERE ───────────────────────────────────────────────
 * Fuel is a percentage of Tarief, and Tarief can be corrected by hand. The
 * Engine's stored fuel line was calculated against the Engine's own base price,
 * so an operator raising the Tarief from 100 to 120 would otherwise still be
 * charged the fuel of 100 — a figure that no longer matches its own basis.
 *
 * ── AND WHY IT USES THE SNAPSHOT'S OWN PERCENTAGE ───────────────────────────
 * The rate is DERIVED from the snapshot — `engineFuel / engineTarief` — rather
 * than read from the current FUEL_PERCENTAGE setting. That is deliberate and it
 * is what keeps a closed Trip historical: the ratio is the percentage that
 * applied on the day the Trip was priced, so an administrator moving the
 * setting from 15% to 20% changes nothing here. Only an explicit reprocess
 * writes a new snapshot, and with it a new ratio.
 *
 * Without an override the Engine's own line is returned untouched, so a Trip
 * nobody has corrected reads exactly as it always did.
 */
function resolveFuel(
  effectiveTarief: Prisma.Decimal,
  engineTarief: Prisma.Decimal | null,
  engineFuel: Prisma.Decimal | null,
): Prisma.Decimal {
  if (engineFuel === null) {
    return ZERO;
  }

  /*
   * No basis to derive a rate from: a Trip the Engine priced at nothing, or one
   * with no base price line at all. Recomputing would mean inventing a
   * percentage, so the stored figure stands.
   */
  if (engineTarief === null || engineTarief.isZero()) {
    return engineFuel;
  }

  if (effectiveTarief.equals(engineTarief)) {
    return engineFuel;
  }

  // Rounded once, at the schema's two places, exactly as the calculator does.
  return engineFuel
    .dividedBy(engineTarief)
    .times(effectiveTarief)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * Resolves the effective breakdown from engine lines and operator overrides.
 *
 * ── WHY CUSTOM PROPERTIES ARE SUMMED BEFORE OVERRIDING ──────────────────────
 * A Trip may carry several priced properties, and the Engine writes one line
 * per property. An override on CUSTOM_PROPERTY therefore replaces the SUM of
 * them rather than one of them — there is one override per component code, and
 * that is what the unique constraint says. Overriding an individual property
 * would need its own key, which the approved model does not have.
 *
 * Pure: it reads two lists and returns a value. Nothing here queries, writes or
 * rounds — the amounts are already stored at two decimal places, and adding
 * exact Decimals cannot introduce a third.
 */
export function resolveEffectivePricing(
  engineAmounts: readonly EngineAmount[],
  overrides: readonly OverrideAmount[],
): EffectivePricing {
  const overrideByComponent = new Map(
    overrides.map((override) => [override.componentCode, override.amount]),
  );

  const engineByComponent = new Map<string, Prisma.Decimal>();

  for (const line of engineAmounts) {
    const running = engineByComponent.get(line.componentCode) ?? ZERO;

    engineByComponent.set(line.componentCode, running.plus(line.amount));
  }

  // Every component either side knows about, so an override on a component the
  // Engine produced nothing for is still resolved.
  const codes = new Set([
    ...engineByComponent.keys(),
    ...overrideByComponent.keys(),
  ]);

  const components: EffectiveAmount[] = [...codes]
    .sort((left, right) => left.localeCompare(right))
    .map((componentCode) => {
      const engineAmount = engineByComponent.get(componentCode) ?? null;
      const override = overrideByComponent.get(componentCode);

      return {
        componentCode,
        engineAmount,
        effectiveAmount: override ?? engineAmount ?? ZERO,
        source: override
          ? PricingAmountSource.OVERRIDE
          : PricingAmountSource.ENGINE,
      };
    });

  const effective = (componentCode: string): Prisma.Decimal =>
    components.find((component) => component.componentCode === componentCode)
      ?.effectiveAmount ?? ZERO;

  const others = OTHERS_COMPONENTS.reduce(
    (sum, componentCode) => sum.plus(effective(componentCode)),
    ZERO,
  );

  const tarief = effective(EffectiveComponent.BASE_PRICE);
  const brandstof = resolveFuel(
    tarief,
    engineByComponent.get(EffectiveComponent.BASE_PRICE) ?? null,
    engineByComponent.get(EffectiveComponent.FUEL_SURCHARGE) ?? null,
  );
  const backload = effective(EffectiveComponent.COMBINATION);
  const tol = effective(EffectiveComponent.TOLL);
  const tunnel = effective(EffectiveComponent.TUNNEL);
  const ek = effective(EffectiveComponent.COST_CONFIRMATION);

  return {
    components,
    tarief,
    brandstof,
    backload,
    tol,
    tunnel,
    others,
    ek,
    // Always derived. A stored total that could drift from its own parts is the
    // one thing this whole layer exists to prevent.
    totaal: tarief
      .plus(brandstof)
      .plus(backload)
      .plus(tol)
      .plus(tunnel)
      .plus(others)
      .plus(ek),
  };
}

/**
 * The only three amounts an operator may type.
 *
 * ── WHY THE LIST IS THIS SHORT ──────────────────────────────────────────────
 * Every other component is DERIVED from something the operator can already
 * change, so an override on it would be a second, competing answer:
 *
 *   Brandstof is a percentage of the effective Tarief — correct the Tarief;
 *   Backload follows from Combination membership — change the grouping;
 *   Others is Waiting Time plus the priced Custom Properties — edit one of
 *     those, which is where the amount actually lives;
 *   EK is the Cost Confirmation, and the confirmation is the evidence — an
 *     amount typed over it would be a figure with no document behind it;
 *   Totaal is a sum, and a sum that disagrees with its parts is not a total.
 *
 * Toll and Tunnel are here because nothing calculates them yet: their value IS
 * whatever the operator entered, so the override is not a correction but the
 * only source there is.
 */
const OVERRIDABLE_COMPONENTS: readonly string[] = [
  EffectiveComponent.BASE_PRICE,
  EffectiveComponent.TOLL,
  EffectiveComponent.TUNNEL,
];

/**
 * Whether a component may carry an operator override.
 *
 * Enforced HERE rather than only in the UI. A disabled input is a convenience;
 * this is the rule, and the write path must consult it so no request can store
 * an override the pricing model would then have to explain.
 */
export function isOverridableComponent(componentCode: string): boolean {
  return OVERRIDABLE_COMPONENTS.includes(componentCode);
}
