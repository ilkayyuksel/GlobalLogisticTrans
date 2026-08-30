import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { MONEY_DECIMAL_PLACES } from "../common/dto/money";
import { AppLoggerService } from "../logger/app-logger.service";
import { TripNotFoundException } from "../trips/exceptions/trip.exceptions";
import { TripReadService } from "../trips/trip-read.service";
import {
  EffectivePricingDto,
  toEffectivePricingDto,
} from "./dto/effective-pricing.dto";
import { UpsertTripPricingOverrideDto } from "./dto/upsert-trip-pricing-override.dto";
import { EffectivePricingService } from "./effective-pricing.service";
import { isOverridableComponent } from "./effective-pricing";
import {
  PricingComponentNotOverridableException,
  TripPricingOverrideNotFoundException,
} from "./exceptions/trip-pricing.exceptions";
import { TripPricingOverrideRepository } from "./trip-pricing-override.repository";

/**
 * Operator corrections to a Trip's price.
 *
 * ── WHY OVERRIDES ARE NOT PART OF THE SNAPSHOT ──────────────────────────────
 * The Pricing Engine REPLACES a snapshot wholesale when a Trip is reprocessed:
 * every line is deleted and written again. A correction stored among those
 * lines would be destroyed by the next recalculation, so it lives in its own
 * table and is applied on top at read time. That is what lets a reprocess pick
 * up a new fuel percentage while leaving the operator's Tarief standing.
 *
 * ── WHAT THIS SERVICE REFUSES ───────────────────────────────────────────────
 * Only BASE_PRICE, TOLL and TUNNEL admit an override, and the rule is checked
 * HERE rather than only in the browser. A disabled input is a convenience; this
 * is the boundary, and it holds for any caller that can reach the endpoint.
 * ────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class TripPricingOverrideService {
  constructor(
    private readonly overrides: TripPricingOverrideRepository,
    private readonly effectivePricing: EffectivePricingService,
    private readonly trips: TripReadService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(TripPricingOverrideService.name);
  }

  /**
   * Records a correction and returns what the Trip is now worth.
   *
   * Returning the recalculated breakdown rather than the stored row is what
   * keeps the screen off a second round trip: one save, one authoritative
   * answer, including the components that moved because of it — Brandstof
   * follows the Tarief, and Totaal follows everything.
   *
   * `overriddenBy` is a parameter rather than a field of the DTO because it
   * comes from the verified token. See `CurrentSubject`.
   */
  async upsert(
    tripId: string,
    dto: UpsertTripPricingOverrideDto,
    overriddenBy: string,
  ): Promise<EffectivePricingDto | null> {
    assertOverridable(dto.componentCode);

    // An unknown Trip raises the same 404 it raises everywhere.
    await this.requireTrip(tripId);

    await this.overrides.upsert({
      tripId,
      componentCode: dto.componentCode,
      /*
       * Through the fixed-precision string rather than the JSON number. The
       * validator has already bounded it to two decimals; going via the string
       * means the stored Decimal is the figure the operator typed, with no
       * binary artefact of the double it arrived as.
       */
      amount: new Prisma.Decimal(dto.amount.toFixed(MONEY_DECIMAL_PLACES)),
      overriddenBy,
    });

    // No amount in the log line: pricing is commercial information, and this
    // module's errors observe the same rule.
    this.logger.log("Stored a manual pricing override", {
      tripId,
      componentCode: dto.componentCode,
      overriddenBy,
    });

    return this.readEffective(tripId);
  }

  /**
   * Withdraws a correction, returning the component to the calculated figure.
   *
   * Deliberately its own operation rather than a save of an empty value. An
   * empty field is indistinguishable from zero, and zero is a legitimate
   * amount — a Trip genuinely without toll. Conflating the two would make
   * "0.00" impossible to enter and every cleared field ambiguous.
   */
  async reset(
    tripId: string,
    componentCode: string,
  ): Promise<EffectivePricingDto | null> {
    assertOverridable(componentCode);

    await this.requireTrip(tripId);

    const wasRemoved = await this.overrides.remove(tripId, componentCode);

    if (!wasRemoved) {
      throw new TripPricingOverrideNotFoundException(tripId, componentCode);
    }

    this.logger.log("Withdrew a manual pricing override", {
      tripId,
      componentCode,
    });

    return this.readEffective(tripId);
  }

  /**
   * Refuses a correction to a Trip that does not exist.
   *
   * Through the narrow Trip READ side rather than TripService: it raises the
   * same exception, so the 404 is unchanged, and the pricing module stops
   * depending on the planning domain — which is what keeps the Engine's
   * dependency on this module from closing a cycle.
   */
  private async requireTrip(tripId: string): Promise<void> {
    if ((await this.trips.findById(tripId)) === null) {
      throw new TripNotFoundException(tripId);
    }
  }

  /**
   * Null when the Trip has never been priced — an ordinary state, and the same
   * answer `TripPricingService.findByTripId` gives. A correction is still
   * stored for such a Trip: it applies as soon as the Engine prices it.
   */
  private readEffective(tripId: string): Promise<EffectivePricingDto | null> {
    return this.effectivePricing
      .findForTrip(tripId)
      .then((pricing) => (pricing ? toEffectivePricingDto(pricing) : null));
  }
}

function assertOverridable(componentCode: string): void {
  if (!isOverridableComponent(componentCode)) {
    throw new PricingComponentNotOverridableException(componentCode);
  }
}
