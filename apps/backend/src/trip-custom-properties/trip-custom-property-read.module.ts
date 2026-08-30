import { Module } from "@nestjs/common";

import { TripCustomPropertyReadRepository } from "./trip-custom-property-read.repository";
import { TripCustomPropertyReadService } from "./trip-custom-property-read.service";

/**
 * Reading which Custom Properties a Trip carries — and nothing else.
 *
 * Assigning or removing a property now recalculates the Trip's pricing, so
 * TripCustomPropertyModule depends on the Pricing Engine. The Engine still has
 * to read the assignments, and reading them through the write module would
 * close that loop:
 *
 *     TripCustomPropertyModule ──> PricingEngineModule
 *                                          │
 *                                          v
 *                       TripCustomPropertyReadModule ──> Prisma
 *
 * Assign, remove and update stay in the write module. This one imports nothing,
 * must never import PricingEngineModule, and must never grow a write.
 */
@Module({
  providers: [TripCustomPropertyReadService, TripCustomPropertyReadRepository],
  exports: [TripCustomPropertyReadService],
})
export class TripCustomPropertyReadModule {}
