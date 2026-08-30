import { Module } from "@nestjs/common";

import { CustomPropertyModule } from "../custom-properties/custom-property.module";
import { PricingEngineModule } from "../pricing-engine/pricing-engine.module";
import { TripModule } from "../trips/trip.module";
import { TripCustomPropertyController } from "./trip-custom-property.controller";
import { TripCustomPropertyRepository } from "./trip-custom-property.repository";
import { TripCustomPropertyService } from "./trip-custom-property.service";

/**
 * PrismaModule and LoggerModule are global, so only the modules whose services
 * are called directly are imported.
 *
 * TripModule supplies the Trip's existence check and its container type;
 * CustomPropertyModule the property's existence and active state. Neither is
 * written to from here — assigning a property must never modify the Trip or the
 * property itself.
 *
 * ── WHY IT DEPENDS ON THE PRICING ENGINE ────────────────────────────────────
 * A priced property changes what the Trip is worth, and the operator has to see
 * the new figure in the answer to their own request. So a write recalculates
 * through PricingRecalculationService and returns the result.
 *
 * The arrow points ONE way. The Engine reads a Trip's assignments through
 * TripCustomPropertyReadModule — a separate, narrow, read-only module that
 * imports nothing but Prisma — so it never reaches back into this one:
 *
 *     TripCustomPropertyModule ──> PricingEngineModule
 *                                          │
 *                                          v
 *                       TripCustomPropertyReadModule ──> Prisma
 *
 * There is no forwardRef anywhere in that picture, and there must not be: a
 * forwardRef would hide the cycle rather than remove it.
 *
 * TripCustomPropertyService is exported for the write side alone. The Engine
 * does not use it.
 */
@Module({
  imports: [TripModule, CustomPropertyModule, PricingEngineModule],
  controllers: [TripCustomPropertyController],
  providers: [TripCustomPropertyService, TripCustomPropertyRepository],
  exports: [TripCustomPropertyService],
})
export class TripCustomPropertyModule {}
