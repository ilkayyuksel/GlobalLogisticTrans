import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { TripPricingRepository, type TripPricingWithItems } from "./trip-pricing.repository";

/** A new fuel line for a stored snapshot. Every figure is already calculated. */
export interface ReplaceFuelLineCommand {
  readonly tripId: string;
  readonly tripPricingId: string;
  /** The calculation that was read; a snapshot replaced since is left alone. */
  readonly calculatedAt: Date;
  readonly fuelItemId: string;
  readonly amount: Prisma.Decimal;
  readonly description: string;
  /** The percentage the amount was calculated with. */
  readonly unitPrice: Prisma.Decimal;
  /** The snapshot's total with this fuel line: the sum of its lines. */
  readonly totalPrice: Prisma.Decimal;
}

/**
 * Reads a Trip's current snapshot and rewrites ONLY its fuel line — the store
 * behind "Brandstof herberekenen" (`FuelRecalculationService`).
 *
 * ── STORES, NEVER CALCULATES ────────────────────────────────────────────────
 * Like `TripPricingService`, nothing here computes an amount: the new line and
 * the total arrive calculated. Every other line, the route, the header's
 * calculation metadata and every override stay exactly as they are.
 *
 * ── ONE CALCULATION, OR NOTHING ─────────────────────────────────────────────
 * The fuel line and the total are written in ONE transaction, and only while
 * the snapshot is still the one that was read: a full recalculation that
 * replaced it in between (new `calculatedAt`, new line ids) wins, and nothing
 * is written — the caller reports the Trip as not recalculated.
 */
@Injectable()
export class FuelLineStore {
  constructor(
    private readonly repository: TripPricingRepository,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(FuelLineStore.name);
  }

  /** The Trip's CURRENT snapshot with its lines, or null — see `current-pricing.ts`. */
  async findCurrentSnapshot(tripId: string): Promise<TripPricingWithItems | null> {
    const [snapshot] = await this.repository.findCurrentByTripIds([tripId]);

    return snapshot ?? null;
  }

  /** True when written; false when the snapshot changed since it was read. */
  async replaceFuelLine(command: ReplaceFuelLineCommand): Promise<boolean> {
    const written = await this.repository.runInTransaction(async ({ pricing, items }) => {
      const headerWritten = await pricing.updateTotalIfUnchanged(
        command.tripPricingId,
        command.calculatedAt,
        command.totalPrice,
      );

      if (!headerWritten) {
        return false;
      }

      const lineWritten = await items.updateLineOfSnapshot(command.fuelItemId, command.tripPricingId, {
        amount: command.amount,
        description: command.description,
        unitPrice: command.unitPrice,
      });

      if (!lineWritten) {
        // Same calculation, but its fuel line is gone: undo the total with it.
        throw new FuelLineChangedError(command.tripId);
      }

      return true;
    }).catch((error: unknown) => {
      if (error instanceof FuelLineChangedError) {
        return false;
      }

      throw error;
    });

    // No amount and no percentage in the log: both are commercial information.
    this.logger.log(written ? "Fuel line replaced" : "Fuel line not replaced: snapshot changed since read", {
      tripId: command.tripId,
      tripPricingId: command.tripPricingId,
    });

    return written;
  }
}

/** Internal: rolls the transaction back when the fuel line vanished. */
class FuelLineChangedError extends Error {
  constructor(tripId: string) {
    super(`The fuel line of Trip "${tripId}" changed while it was being replaced.`);
  }
}
