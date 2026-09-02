import { Injectable } from "@nestjs/common";
import { PricingComponent } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";

/** What creating one catalog row needs. */
export interface CreatePricingComponentData {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly displayOrder: number;
}

/**
 * Database access for the `pricing_component` catalog.
 *
 * ── DELIBERATELY NARROW ─────────────────────────────────────────────────────
 * Read the active codes, and create the ones that are missing. That is all the
 * bootstrap needs, and the bootstrap is the only writer: nothing in the API
 * renames, reorders, deactivates or deletes a component, because every pricing
 * item ever stored points at one and the classification of a historical
 * breakdown must not change under it.
 *
 * It lives in the settings module rather than in a module of its own. The
 * catalog is reference data with exactly one consumer — the pricing bootstrap,
 * which is the configuration story this module already owns — and a module
 * holding one repository for one caller would be an abstraction built for a
 * phase that has not arrived. `TripPricingItemRepository` reads the same table
 * for classification and says the same thing about it.
 * ────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class PricingComponentRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The codes currently held, among ACTIVE rows only.
   *
   * Active is what the unique index covers (`code` is unique WHERE `is_active`)
   * and what every consumer resolves against, so an inactive row is not a row
   * that satisfies the catalog. Somebody deactivated it on purpose; the
   * bootstrap reports the gap rather than reactivating a decision it did not
   * make.
   */
  async findActiveCodes(): Promise<string[]> {
    const components = await this.prisma.pricingComponent.findMany({
      where: { isActive: true },
      select: { code: true },
    });

    return components.map((component) => component.code);
  }

  /**
   * Creates the given rows.
   *
   * `createMany` in one statement: the bootstrap has already worked out which
   * codes are absent, and inserting them one at a time would multiply round
   * trips for no gain. A concurrent bootstrap racing this one is stopped by the
   * partial unique index rather than by a check, which is where that guarantee
   * belongs.
   */
  createMany(
    components: readonly CreatePricingComponentData[],
  ): Promise<{ count: number }> {
    return this.prisma.pricingComponent.createMany({ data: [...components] });
  }

  /** One component by code, among active rows. Used by tests and diagnostics. */
  findActiveByCode(code: string): Promise<PricingComponent | null> {
    return this.prisma.pricingComponent.findFirst({
      where: { code, isActive: true },
    });
  }
}
