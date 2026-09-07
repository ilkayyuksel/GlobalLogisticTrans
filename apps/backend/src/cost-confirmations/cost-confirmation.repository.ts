import { Injectable } from "@nestjs/common";
import { CostConfirmation, Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";

export type CreateCostConfirmationData =
  Prisma.CostConfirmationUncheckedCreateInput;

/**
 * Database access for confirmed costs.
 *
 * No update and no delete, and that is the design rather than an omission: a
 * cost confirmation is a statement by somebody else. Correcting it would mean
 * claiming Eucon said something it did not, and the only honest way to change
 * the picture is a NEW confirmation, which is a new row.
 */
/**
 * Newest first, and DETERMINISTIC.
 *
 * `received_at` is written by the importer at the moment the document is
 * processed, so it is the arrival order rather than anything the document
 * claims about itself. Two confirmations processed in the same millisecond
 * would tie on it, and "which is latest" must never depend on the order the
 * database happens to return rows in — so `created_at` and finally the primary
 * key break the tie. The answer is the same on every query.
 */
const NEWEST_FIRST = [
  { receivedAt: "desc" },
  { createdAt: "desc" },
  { id: "desc" },
] as const satisfies Prisma.CostConfirmationOrderByWithRelationInput[];

@Injectable()
export class CostConfirmationRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: CreateCostConfirmationData): Promise<CostConfirmation> {
    return this.prisma.costConfirmation.create({ data });
  }

  /**
   * Every confirmation this Trip holds, NEWEST FIRST.
   *
   * It was `findUnique` on a unique `trip_id`, where the question was only
   * "is there one already". A Trip may now hold several, so both questions the
   * callers ask — which is the latest, and what do they add up to — are
   * answered from this one ordered list.
   */
  findAllByTrip(tripId: string): Promise<CostConfirmation[]> {
    return this.prisma.costConfirmation.findMany({
      where: { tripId },
      orderBy: NEWEST_FIRST,
    });
  }

  /**
   * Every confirmation of every Trip on a page, newest first.
   *
   * ONE query for the whole page, as before. The Ritten list shows the latest
   * confirmation beside each Trip and a query per row would be a request per
   * truck — which matters more now that a Trip can hold several, not less.
   * Grouping by Trip is the caller's job; ordering is guaranteed here.
   */
  findForTrips(tripIds: readonly string[]): Promise<CostConfirmation[]> {
    if (tripIds.length === 0) {
      return Promise.resolve([]);
    }

    return this.prisma.costConfirmation.findMany({
      where: { tripId: { in: [...tripIds] } },
      orderBy: NEWEST_FIRST,
    });
  }
}
