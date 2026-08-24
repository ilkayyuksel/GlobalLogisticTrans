import { Injectable } from "@nestjs/common";

import { CustomPropertyService } from "../custom-properties/custom-property.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { TripCustomPropertyRepository } from "../trip-custom-properties/trip-custom-property.repository";
import {
  FLAT_CUSTOM_PROPERTY_NAME,
  requiresFlatProperty,
} from "./flat-container-rule";
import { MissingRequiredCustomPropertyException } from "./exceptions/trip.exceptions";

/**
 * Keeps the Flat property in step with a Trip's container type.
 *
 * ── WHY THIS IS A WRITE AND NOT A CALCULATION ───────────────────────────────
 * The other automatic property in this system — TAR — is applied by the Pricing
 * Engine while it calculates, and is never stored. That works because TAR only
 * ever needs to be true at the moment of pricing.
 *
 * Flat is different: an operator must SEE it on the Trip, in the list and in
 * the property panel, long before anything is priced. A property nobody can see
 * is a charge nobody can check, so this rule writes a real assignment row like
 * any other and everything downstream — the list, the panel, the Pricing
 * Engine — reads it without knowing it was automatic.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * ── WHAT IT WILL AND WILL NOT TOUCH ─────────────────────────────────────────
 * Only Flat, and only the rows it is allowed to own. An assignment carries
 * `isAutomatic`, and this service:
 *
 *   - writes `isAutomatic = true` when it adds Flat itself;
 *   - removes ONLY `isAutomatic = true` rows;
 *   - leaves a manual Flat exactly as it is, including never converting it —
 *     the operator's decision outlives a rule that happens to agree with it;
 *   - never looks at, adds or removes any other property.
 *
 * Every method takes the repository to write through rather than using an
 * injected one, so the caller's transaction is the transaction: the Trip and
 * its Flat assignment commit together or not at all.
 * ────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class AutomaticFlatPropertyService {
  constructor(
    private readonly customProperties: CustomPropertyService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(AutomaticFlatPropertyService.name);
  }

  /**
   * Applies the rule to a Trip that has just been created.
   *
   * A brand-new Trip carries no properties, so there is nothing to remove and
   * nothing to check for duplicates — which is why a container type that
   * requires nothing costs no query at all. That matters: most Trips are 45PH,
   * and this runs inside every import.
   */
  async applyToNewTrip(
    repository: TripCustomPropertyRepository,
    tripId: string,
    containerType: string | null,
  ): Promise<void> {
    if (!requiresFlatProperty(containerType)) {
      return;
    }

    const flat = await this.requireFlatProperty(containerType as string);

    await repository.create({
      tripId,
      customPropertyId: flat.id,
      isAutomatic: true,
    });

    this.logger.log("Flat assigned automatically", {
      tripId,
      customPropertyId: flat.id,
      containerType,
    });
  }

  /**
   * Brings an existing Trip's Flat assignment in line with its container type.
   *
   * Idempotent, and deliberately re-run on every revision rather than only when
   * the container type is seen to change: the question it answers is "does this
   * Trip's Flat match its type right now", which needs no memory of what the
   * type used to be. A revision that changes nothing therefore changes nothing
   * here either.
   *
   *   requires Flat, has none            → adds it, automatic
   *   requires Flat, already has it      → nothing, whatever its source
   *   requires none, has an automatic    → removes it
   *   requires none, has a manual one    → nothing; it was somebody's decision
   */
  async synchronise(
    repository: TripCustomPropertyRepository,
    tripId: string,
    containerType: string | null,
  ): Promise<void> {
    const flat = await this.customProperties.findActiveByName(
      FLAT_CUSTOM_PROPERTY_NAME,
    );
    const required = requiresFlatProperty(containerType);

    /*
     * No Flat property configured at all. With the type requiring it that is a
     * refusal, exactly as on creation; otherwise there is nothing this rule
     * could have assigned and therefore nothing to withdraw.
     */
    if (!flat) {
      if (required) {
        throw new MissingRequiredCustomPropertyException(
          FLAT_CUSTOM_PROPERTY_NAME,
          containerType as string,
        );
      }

      return;
    }

    const existing = await repository.findByTripAndProperty(tripId, flat.id);

    if (required) {
      if (existing) {
        return;
      }

      await repository.create({
        tripId,
        customPropertyId: flat.id,
        isAutomatic: true,
      });

      this.logger.log("Flat assigned automatically", {
        tripId,
        customPropertyId: flat.id,
        containerType,
      });

      return;
    }

    // The container type no longer requires it. Only what this rule put there
    // may be taken away again.
    if (!existing || !existing.isAutomatic) {
      return;
    }

    await repository.delete(existing.id);

    this.logger.log("Automatic Flat removed", {
      tripId,
      customPropertyId: flat.id,
      containerType,
    });
  }

  /**
   * The configured Flat property, or a refusal.
   *
   * A Trip whose type requires Flat must not be stored without it: the charge
   * would be missing from every calculation afterwards, with nothing on the
   * Trip to reveal it. Raising here rolls back the Trip write with it.
   */
  private async requireFlatProperty(containerType: string) {
    const flat = await this.customProperties.findActiveByName(
      FLAT_CUSTOM_PROPERTY_NAME,
    );

    if (!flat) {
      this.logger.error(
        "The Custom Property required by a container type is not configured",
        { propertyName: FLAT_CUSTOM_PROPERTY_NAME, containerType },
      );

      throw new MissingRequiredCustomPropertyException(
        FLAT_CUSTOM_PROPERTY_NAME,
        containerType,
      );
    }

    return flat;
  }
}
