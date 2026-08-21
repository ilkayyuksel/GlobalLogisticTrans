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
@Injectable()
export class CostConfirmationRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: CreateCostConfirmationData): Promise<CostConfirmation> {
    return this.prisma.costConfirmation.create({ data });
  }

  /**
   * The confirmation this Trip already holds, if any.
   *
   * By TRIP, because a Trip has at most one: the question is never "which
   * confirmation" but "is there one already".
   */
  findByTrip(tripId: string): Promise<CostConfirmation | null> {
    return this.prisma.costConfirmation.findUnique({ where: { tripId } });
  }

  /**
   * The confirmation of each Trip on a page — at most one apiece.
   *
   * One query for the whole page: the Ritten list shows the confirmed amount
   * beside the Trip, and a query per row would be a request per truck.
   */
  findForTrips(tripIds: readonly string[]): Promise<CostConfirmation[]> {
    if (tripIds.length === 0) {
      return Promise.resolve([]);
    }

    return this.prisma.costConfirmation.findMany({
      where: { tripId: { in: [...tripIds] } },
      orderBy: { receivedAt: "desc" },
    });
  }
}
