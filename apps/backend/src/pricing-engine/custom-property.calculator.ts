import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { MissingCustomPropertyPriceException } from "./exceptions/pricing-engine.exceptions";
import {
  PricingCalculationContext,
  PricingCustomPropertyInput,
} from "./pricing-calculation-context";
import {
  PricingCalculationStep,
  PricingComponentCode,
  PricingLine,
} from "./pricing-line";
import { toStorableAmount } from "./pricing-money";

/** pricing_rules.md numbers the Custom Properties seventh in the sequence. */
export const CUSTOM_PROPERTY_CALCULATION_ORDER = 7;

/**
 * Calculates the fixed-price Custom Properties — step 7 of the pricing
 * sequence.
 *
 * A Custom Property is priced in one of two ways, and the model distinguishes
 * them by a single field. A property with NO Pricing Component link carries its
 * own `defaultPrice`, and that is what this step charges. A property WITH a
 * link declares only that a route-dependent component applies; its amount comes
 * from the route cost configuration and was already charged by the Toll or
 * Tunnel step. Testing `pricingComponentId === null` therefore separates the
 * two exactly, and does so without naming a single component — a route-priced
 * component added years from now is excluded here automatically, with no change
 * to this file.
 *
 * Unlike every other step, the produced line carries a `customPropertyId`. This
 * is the one component whose amount comes from a specific configured property,
 * so the reference is what explains the charge on a breakdown; for every other
 * component the amount belongs to the route or to a Setting.
 *
 * One line per assigned property, in the order the context supplies — which is
 * the properties' configured display order. No sorting is applied here: a
 * second ordering rule could disagree with the first, and the breakdown would
 * stop matching the order an administrator arranged.
 *
 * The calculator neither de-duplicates nor checks whether a property is still
 * active. A property cannot be assigned to the same Trip twice — a unique index
 * guarantees it — and an assignment already made stays priceable even after the
 * property is withdrawn from the catalog, so re-checking either would only risk
 * contradicting a rule that is already enforced where it belongs.
 *
 * All arithmetic is Decimal. Amounts and property names are never logged.
 */
@Injectable()
export class CustomPropertyCalculator implements PricingCalculationStep {
  constructor(private readonly logger: AppLoggerService) {
    this.logger.setContext(CustomPropertyCalculator.name);
  }

  calculate(context: PricingCalculationContext): PricingLine[] {
    this.logger.log("Custom property calculation started", {
      tripId: context.tripId,
      assignedCount: context.assignedCustomProperties.length,
    });

    const lines = context.assignedCustomProperties
      .filter(isFixedPrice)
      .map((property) => this.propertyLine(context.tripId, property));

    this.logger.log("Custom property calculation completed", {
      tripId: context.tripId,
      lineCount: lines.length,
    });

    return lines;
  }

  /**
   * The property's own configured price, unchanged.
   *
   * A missing price is refused rather than treated as zero. The property was
   * assigned deliberately, so the charge exists; only its amount is unknown,
   * and inventing zero for it would put a quietly wrong figure on an invoice.
   *
   * Quantity and unit price stay null — a fixed-price property is a flat
   * amount, not a rate per unit of anything.
   */
  private propertyLine(
    tripId: string,
    property: PricingCustomPropertyInput,
  ): PricingLine {
    if (property.defaultPrice === null) {
      this.logger.warn("Fixed-price custom property has no configured price", {
        tripId,
        customPropertyId: property.customPropertyId,
      });

      throw new MissingCustomPropertyPriceException(
        tripId,
        property.customPropertyId,
      );
    }

    return {
      component: PricingComponentCode.CUSTOM_PROPERTY,
      description: property.name,
      amount: toStorableAmount(new Prisma.Decimal(property.defaultPrice)),
      calculationOrder: CUSTOM_PROPERTY_CALCULATION_ORDER,
      quantity: null,
      unitPrice: null,
      customPropertyId: property.customPropertyId,
    };
  }
}

/**
 * A property is fixed-price exactly when it links to no Pricing Component.
 *
 * Deliberately expressed as the absence of a link rather than as a list of
 * excluded component codes: TOLL and TUNNEL are excluded because they are
 * linked, not because they are named here, so nothing needs adding when a third
 * route-priced component arrives.
 */
function isFixedPrice(property: PricingCustomPropertyInput): boolean {
  return property.pricingComponentId === null;
}
