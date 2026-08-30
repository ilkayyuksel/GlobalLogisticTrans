import { Module } from "@nestjs/common";

import { TripReadModule } from "../trips/trip-read.module";
import { EffectivePricingModule } from "./effective-pricing.module";
import { TripPricingController } from "./trip-pricing.controller";
import { TripPricingOverrideController } from "./trip-pricing-override.controller";
import { TripPricingOverrideService } from "./trip-pricing-override.service";
import { TripPricingRepository } from "./trip-pricing.repository";
import { TripPricingItemRepository } from "../trip-pricing-items/trip-pricing-item.repository";
import { TripPricingOverrideRepository } from "./trip-pricing-override.repository";
import { TripPricingService } from "./trip-pricing.service";

/**
 * PrismaModule and LoggerModule are global, so only two modules are imported.
 *
 * ── WHY TripReadModule AND NOT TripModule ───────────────────────────────────
 * The Trip existence lookup still happens: a correction is refused, and a
 * pricing read 404s, for a Trip that does not exist. What changed is where the
 * lookup comes from.
 *
 * The Pricing Engine imports this module to persist its snapshots, and
 * TripModule imports the Engine so that editing a waiting time recalculates. So
 * an import of TripModule from here would close the loop
 * TripModule -> PricingEngine -> TripPricing -> TripModule. TripReadModule is
 * the narrow read side of the same table: it imports nothing but Prisma, it
 * raises the same TripNotFoundException, and it sits below all three.
 *
 * The Ritten list carries each Trip's effective pricing, which TripModule reads
 * through EffectivePricingModule — also below both of us, also depending on
 * neither. Nothing here is reachable from Trip: not the overrides, not the
 * Engine, not the reprocess path.
 *
 * TripPricingService is exported because the future Pricing Engine persists its
 * results through the service, never through the repository, so database access
 * stays behind a single door.
 */
@Module({
  imports: [TripReadModule, EffectivePricingModule],
  controllers: [TripPricingController, TripPricingOverrideController],
  providers: [
    TripPricingService,
    TripPricingRepository,
    TripPricingOverrideRepository,
    TripPricingOverrideService,
    TripPricingItemRepository,
  ],
  /*
   * EffectivePricingModule is re-exported because EffectivePricingService is
   * the SHARED source the Ritten columns, the Trip detail panel and both Excel
   * exports read, and every module that already imports this one expects to
   * find it here. The read itself now lives one level down — see that module
   * for why. Exporting the override repository too would invite a caller to
   * write one without going through the rules; it stays inside.
   */
  exports: [TripPricingService, EffectivePricingModule],
})
export class TripPricingModule {}
