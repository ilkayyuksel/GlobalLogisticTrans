import { Module } from "@nestjs/common";

import { TripRouteSelectionRepository } from "./trip-route-selection.repository";

/**
 * The operators' route choices, below both the Trip module and the Pricing
 * Engine: it imports nothing but Prisma, which is global, so both can use it
 * without a cycle — the same arrangement as `TripReadModule`.
 */
@Module({
  providers: [TripRouteSelectionRepository],
  exports: [TripRouteSelectionRepository],
})
export class TripRouteSelectionModule {}
