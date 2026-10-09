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
/** Newest first, with every tie broken, so two reads never disagree. */
const NEWEST_FIRST = [
  { receivedAt: "desc" },
  { createdAt: "desc" },
  { id: "desc" },
] as const satisfies Prisma.CostConfirmationOrderByWithRelationInput[];

@Injectable()
export class CostConfirmationReadRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * EVERY confirmation of one Trip, newest first.
   *
   * It was `findUnique` on a unique `trip_id`. A Trip may now hold several and
   * is worth their SUM, so the Engine reads them all — one query for the Trip
   * it is pricing, which is what it already cost.
   *
   * The order is the arrival order and matters to the caller: the breakdown
   * names the confirmations newest first, the same way the Ritten row picks
   * the latest.
   */
  findAllByTrip(tripId: string): Promise<CostConfirmationPricingRow[]> {
    return this.prisma.costConfirmation.findMany({
      where: { tripId },
      orderBy: NEWEST_FIRST,
      select: PRICING_COLUMNS,
    });
  }

  /**
   * The confirmation numbers of many Trips, in ONE query, newest first.
   *
   * Only the reference and its Trip: no amount, because whoever asks for the
   * references is not pricing anything.
   */
  findNumbersForTrips(
    tripIds: readonly string[],
  ): Promise<{ tripId: string; ccNumber: string }[]> {
    return this.prisma.costConfirmation.findMany({
      where: { tripId: { in: [...tripIds] } },
      orderBy: NEWEST_FIRST,
      select: { tripId: true, ccNumber: true },
    });
  }
}
