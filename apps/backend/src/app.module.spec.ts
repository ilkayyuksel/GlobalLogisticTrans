import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";

import { DomainEventBus } from "./common/events/domain-event-bus";
import { AppLoggerService } from "./logger/app-logger.service";

import { AppModule } from "./app.module";
import { CostConfirmationReadModule } from "./cost-confirmations/cost-confirmation-read.module";
import { CostConfirmationModule } from "./cost-confirmations/cost-confirmation.module";
import { PrismaService } from "./prisma/prisma.service";
import { PricingEngineModule } from "./pricing-engine/pricing-engine.module";
import { PricingEngineService } from "./pricing-engine/pricing-engine.service";
import { PricingRecalculationService } from "./pricing-engine/pricing-recalculation.service";
import { TripCustomPropertyReadModule } from "./trip-custom-properties/trip-custom-property-read.module";
import { TripCustomPropertyModule } from "./trip-custom-properties/trip-custom-property.module";
import { TripPricingModule } from "./trip-pricing/trip-pricing.module";
import { TripReadModule } from "./trips/trip-read.module";
import { TripReadService } from "./trips/trip-read.service";
import { TripModule } from "./trips/trip.module";
import { TripService } from "./trips/trip.service";

/**
 * The application's dependency graph, asserted rather than discovered at boot.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Dynamic pricing gave three planning modules a reason to call the Pricing
 * Engine — a Custom Property, a waiting-time window and a Cost Confirmation all
 * change what a Trip is worth — while the Engine still has to READ all three.
 * Done naively that is four cycles:
 *
 *   TripModule               -> PricingEngine -> TripModule
 *   CostConfirmationModule   -> PricingEngine -> CostConfirmationModule
 *   TripCustomPropertyModule -> PricingEngine -> TripCustomPropertyModule
 *   PricingEngine -> TripPricing -> TripModule -> PricingEngine
 *
 * Each was broken by separating the READ side of the table into its own module
 * that imports nothing but Prisma, NOT by forwardRef — which hides a cycle
 * behind a lazy reference and moves the failure from boot to the first
 * undefined dependency.
 *
 * Nest fails a genuine cycle at compile time with "A circular dependency has
 * been detected", so instantiating the whole graph IS the proof. The static
 * assertions below add the part a successful boot cannot show: that the cycles
 * were removed rather than deferred.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * The four global modules the application provides at boot, faked at the edge.
 *
 * PrismaService opens a real connection in `onModuleInit`, and this test is
 * about wiring rather than about the database. Everything above these four —
 * every module, every provider, every injection — is the real graph.
 */
@Global()
@Module({
  providers: [
    { provide: PrismaService, useValue: {} },
    {
      provide: AppLoggerService,
      useValue: {
        setContext: jest.fn(),
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
    },
    { provide: ConfigService, useValue: { get: () => undefined } },
    { provide: DomainEventBus, useValue: { subscribe: jest.fn() } },
  ],
  exports: [PrismaService, AppLoggerService, ConfigService, DomainEventBus],
})
class GlobalStubsModule {}

/** The modules each module under test is allowed to reach, as Nest holds it. */
function importsOf(moduleClass: unknown): unknown[] {
  return (Reflect.getMetadata("imports", moduleClass as object) ??
    []) as unknown[];
}

describe("AppModule dependency graph", () => {
  it("boots the whole application without a circular dependency", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    // Resolvable through the container means every constructor was satisfied.
    expect(moduleRef.get(PricingEngineService, { strict: false })).toBeDefined();
    expect(
      moduleRef.get(PricingRecalculationService, { strict: false }),
    ).toBeDefined();
    expect(moduleRef.get(TripService, { strict: false })).toBeDefined();
    expect(moduleRef.get(TripReadService, { strict: false })).toBeDefined();

    await moduleRef.close();
  });

  it("resolves the Pricing Engine on its own, with only Prisma faked", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [GlobalStubsModule, PricingEngineModule],
    }).compile();

    expect(moduleRef.get(PricingEngineService)).toBeInstanceOf(
      PricingEngineService,
    );
    expect(moduleRef.get(PricingRecalculationService)).toBeInstanceOf(
      PricingRecalculationService,
    );
  });

  describe("the four cycles are gone", () => {
    it("keeps TripModule -> PricingEngine one-way", () => {
      expect(importsOf(TripModule)).toContain(PricingEngineModule);
      expect(importsOf(PricingEngineModule)).not.toContain(TripModule);
      expect(importsOf(PricingEngineModule)).toContain(TripReadModule);
    });

    it("keeps CostConfirmationModule -> PricingEngine one-way", () => {
      expect(importsOf(CostConfirmationModule)).toContain(PricingEngineModule);
      expect(importsOf(PricingEngineModule)).not.toContain(
        CostConfirmationModule,
      );
      expect(importsOf(PricingEngineModule)).toContain(
        CostConfirmationReadModule,
      );
    });

    it("keeps TripCustomPropertyModule -> PricingEngine one-way", () => {
      expect(importsOf(TripCustomPropertyModule)).toContain(
        PricingEngineModule,
      );
      expect(importsOf(PricingEngineModule)).not.toContain(
        TripCustomPropertyModule,
      );
      expect(importsOf(PricingEngineModule)).toContain(
        TripCustomPropertyReadModule,
      );
    });

    it("stops TripPricingModule reaching TripModule", () => {
      expect(importsOf(PricingEngineModule)).toContain(TripPricingModule);
      expect(importsOf(TripPricingModule)).not.toContain(TripModule);
      expect(importsOf(TripPricingModule)).toContain(TripReadModule);
    });
  });

  /**
   * A read module that imported the Engine would close the very cycle it was
   * created to break, and it would do so silently — the boot above would still
   * pass, because Nest resolves a cycle it can order. So the rule is asserted
   * directly.
   */
  it("keeps every read module below the Pricing Engine", () => {
    for (const readModule of [
      TripReadModule,
      CostConfirmationReadModule,
      TripCustomPropertyReadModule,
    ]) {
      expect(importsOf(readModule)).toEqual([]);
    }
  });

  /**
   * forwardRef would make every assertion above pass while leaving the cycle in
   * place. Nest records it as a `{ forwardRef: () => Module }` thunk rather than
   * a class, so an import that is not a constructor is the signature to refuse.
   */
  it("uses no forwardRef anywhere in the pricing graph", () => {
    for (const moduleClass of [
      PricingEngineModule,
      TripModule,
      TripPricingModule,
      TripCustomPropertyModule,
      CostConfirmationModule,
      TripReadModule,
      CostConfirmationReadModule,
      TripCustomPropertyReadModule,
    ]) {
      for (const imported of importsOf(moduleClass)) {
        expect(typeof imported).toBe("function");
        expect(imported).not.toHaveProperty("forwardRef");
      }
    }
  });
});
