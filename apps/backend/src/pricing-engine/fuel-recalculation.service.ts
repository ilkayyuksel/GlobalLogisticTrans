import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { FuelLineStore } from "../trip-pricing/fuel-line.store";
import { toFuelSurchargeLine } from "./fuel-surcharge.calculator";
import { PricingComponentCode } from "./pricing-line";
import { sumLineAmounts } from "./pricing-money";
import { PricingRuleResolver } from "./pricing-rule.resolver";

/** What "Brandstof herberekenen" did to one Trip. */
export const FuelRecalculationResult = {
  /** Its fuel line now carries the current percentage; nothing else changed. */
  RECALCULATED: "RECALCULATED",
  /** No current snapshot: not CLOSED, unknown, or never priced. */
  NOT_PRICED: "NOT_PRICED",
  /** Its snapshot has no single fuel line to recalculate. */
  NO_FUEL_LINE: "NO_FUEL_LINE",
  /** A full recalculation replaced the snapshot meanwhile; that one stands. */
  SNAPSHOT_CHANGED: "SNAPSHOT_CHANGED",
} as const;

export type FuelRecalculationResult =
  (typeof FuelRecalculationResult)[keyof typeof FuelRecalculationResult];

/**
 * "Brandstof herberekenen": a Trip's Brandstof again, at the CURRENT
 * FUEL_PERCENTAGE — and nothing else.
 *
 * ── THE SAME FUEL, ONLY FUEL ────────────────────────────────────────────────
 * The new line is `toFuelSurchargeLine` — the one formula, rounding and
 * description the full calculation uses — on the Tarief the stored snapshot
 * was priced with: every BASE_PRICE line, Over ST and its surcharge included,
 * exactly what the fuel step sees in a full calculation. Tarief, Backload,
 * Toll, Tunnel, Others, EK, the route, the calculation metadata and every
 * override stay as stored. Nothing is matched or priced again.
 *
 * A corrected Tarief is followed as always: the line records the percentage
 * (`unitPrice`), and the effective read applies it to the effective Tarief
 * (`resolveFuel`). Running it twice gives the same line: it is calculated from
 * the Tarief, never from the previous fuel.
 *
 * ── ONE TRIP, ON ITS OWN ────────────────────────────────────────────────────
 * Fuel depends only on the Trip's own Tarief, so its Combination partner is
 * not touched: a Trip nobody selected keeps its fuel.
 */
@Injectable()
export class FuelRecalculationService {
  constructor(
    private readonly rules: PricingRuleResolver,
    private readonly store: FuelLineStore,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(FuelRecalculationService.name);
  }

  /** The FUEL_PERCENTAGE now, validated as every calculation validates it. */
  currentFuelPercentage(): Promise<string> {
    return this.rules.resolveFuelPercentage();
  }

  async recalculate(tripId: string, fuelPercentage: string): Promise<FuelRecalculationResult> {
    const snapshot = await this.store.findCurrentSnapshot(tripId);

    if (snapshot === null) {
      return FuelRecalculationResult.NOT_PRICED;
    }

    const codeOf = (item: (typeof snapshot.items)[number]) => item.pricingComponent.code;
    const fuelLines = snapshot.items.filter((item) => codeOf(item) === PricingComponentCode.FUEL_SURCHARGE);

    if (fuelLines.length !== 1) {
      this.logger.warn("Fuel not recalculated: the snapshot has no single fuel line", {
        tripId,
        fuelLineCount: fuelLines.length,
      });

      return FuelRecalculationResult.NO_FUEL_LINE;
    }

    const [fuelItem] = fuelLines;
    const tarief = sumLineAmounts(
      snapshot.items.filter((item) => codeOf(item) === PricingComponentCode.BASE_PRICE).map((item) => item.amount),
    );
    const fuelLine = toFuelSurchargeLine(tarief, fuelPercentage);
    const totalPrice = sumLineAmounts(
      snapshot.items.map((item) => (item.id === fuelItem.id ? fuelLine.amount : item.amount)),
    );

    const written = await this.store.replaceFuelLine({
      tripId,
      tripPricingId: snapshot.id,
      calculatedAt: snapshot.calculatedAt,
      fuelItemId: fuelItem.id,
      amount: fuelLine.amount,
      description: fuelLine.description,
      unitPrice: fuelLine.unitPrice ?? new Prisma.Decimal(fuelPercentage),
      totalPrice,
    });

    return written ? FuelRecalculationResult.RECALCULATED : FuelRecalculationResult.SNAPSHOT_CHANGED;
  }
}
