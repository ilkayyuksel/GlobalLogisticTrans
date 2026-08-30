import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";

/** The two facts a confirmation contributes to a price. */
const PRICING_COLUMNS = { ccNumber: true, amount: true } as const;

export type CostConfirmationPricingRow = Prisma.CostConfirmationGetPayload<{
  select: typeof PRICING_COLUMNS;
}>;

/**
 * Database access for the Cost Confirmation read side.
 *
 * Deliberately without `create`: this is the half of the domain the Pricing
 * Engine reaches, and a repository that could write would let the Engine
 * record a confirmation — an amount with no document behind it. Writing stays
 * in CostConfirmationRepository, which the import path owns.
 */
@Injectable()
export class CostConfirmationReadRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The confirmation of one Trip, or null.
   *
   * `findUnique` on `trip_id`, which is unique: a Trip has at most one
   * confirmed cost, so the question is never "which one".
   */
  findByTrip(tripId: string): Promise<CostConfirmationPricingRow | null> {
    return this.prisma.costConfirmation.findUnique({
      where: { tripId },
      select: PRICING_COLUMNS,
    });
  }
}
