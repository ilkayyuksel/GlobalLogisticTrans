import { Injectable } from "@nestjs/common";
import { Prisma, TripPricing } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";

export type CreateTripPricingData = Prisma.TripPricingUncheckedCreateInput;
export type UpdateTripPricingData = Prisma.TripPricingUncheckedUpdateInput;

/**
 * Database access for the TripPricing domain.
 *
 * Contains no business rules and performs no arithmetic: the Trip's status
 * check, duplicate policy and error translation belong to TripPricingService,
 * and the amounts themselves are produced by the future Pricing Engine. There
 * is no delete method, because a pricing snapshot is never removed — historical
 * pricing must stay explainable.
 */
@Injectable()
export class TripPricingRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<TripPricing | null> {
    return this.prisma.tripPricing.findUnique({ where: { id } });
  }

  /** Unique on trip_id, so a Trip resolves to at most one snapshot. */
  findByTripId(tripId: string): Promise<TripPricing | null> {
    return this.prisma.tripPricing.findUnique({ where: { tripId } });
  }

  create(data: CreateTripPricingData): Promise<TripPricing> {
    return this.prisma.tripPricing.create({ data });
  }

  update(id: string, data: UpdateTripPricingData): Promise<TripPricing> {
    return this.prisma.tripPricing.update({ where: { id }, data });
  }
}
