import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { EffectiveComponent } from "../../trip-pricing/effective-pricing";
import { TripPricingRepository } from "../../trip-pricing/trip-pricing.repository";

/**
 * The Fuel percentage each Trip's stored calculation used.
 *
 * ── WHY THE INVOICE CHECK NEEDS IT ──────────────────────────────────────────
 * The customer writes Fuel as a formula (`24%*L5`). When a Fuel must go up, the
 * cell can stay a formula in the customer's own shape only if this system's
 * percentage, applied to the row's Tarief, comes to exactly the right amount —
 * see `fuel-cell-plan.ts`. The amount itself comes from `EffectivePricingService`;
 * this reads only the RATE, which that service does not expose.
 *
 * ── READ, NEVER DECIDED ─────────────────────────────────────────────────────
 * The rate is the one the Engine stored on the snapshot's fuel line, exactly
 * as `resolveFuel` reads it. Never the current FUEL_PERCENTAGE setting: a
 * closed Trip keeps the percentage it was priced at. A snapshot written before
 * the rate was recorded has none, and is simply absent — the Fuel is then
 * written as an amount rather than as a formula.
 */
@Injectable()
export class InvoiceFuelRateReader {
  constructor(private readonly snapshots: TripPricingRepository) {}

  async findForTrips(
    tripIds: readonly string[],
  ): Promise<ReadonlyMap<string, Prisma.Decimal>> {
    const rates = new Map<string, Prisma.Decimal>();

    if (tripIds.length === 0) {
      return rates;
    }

    for (const snapshot of await this.snapshots.findCurrentByTripIds(tripIds)) {
      const fuel = snapshot.items.find(
        (item) => item.pricingComponent.code === EffectiveComponent.FUEL_SURCHARGE,
      );

      if (fuel?.unitPrice) {
        rates.set(snapshot.tripId, new Prisma.Decimal(fuel.unitPrice));
      }
    }

    return rates;
  }
}
