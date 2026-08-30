import { Injectable } from "@nestjs/common";

import { MONEY_DECIMAL_PLACES } from "../common/dto/money";
import {
  TripCustomPropertyPricingRow,
  TripCustomPropertyReadRepository,
} from "./trip-custom-property-read.repository";

/**
 * One assigned Custom Property, with everything a calculator needs.
 *
 * `pricingComponentId` distinguishes the two kinds. Null means a fixed-price
 * property whose amount is `defaultPrice`; set means a route-priced one, which
 * declares only that its component applies and takes its amount from the route
 * cost configuration.
 */
export interface AssignedCustomPropertyView {
  readonly customPropertyId: string;
  readonly name: string;
  readonly pricingComponentId: string | null;
  /** Fixed-2 decimal string, never a float. Null on a route-priced property. */
  readonly defaultPrice: string | null;
}

/**
 * The narrow assignment read side.
 *
 * ── WHY THE ENGINE DOES NOT USE TripCustomPropertyService ───────────────────
 * That service owns assign, remove and update, and each of those now
 * recalculates the Trip's pricing — so it depends on the Pricing Engine. The
 * Engine reading assignments back through it would close the cycle.
 *
 * There is a second reason, independent of the graph. The write service's
 * `findByTripId` resolves the Trip first so an unknown Trip is a 404, and it
 * returns the full assignment DTO including the container-type rule that
 * decides whether a property may be removed. The Engine has already resolved
 * the Trip and cares about none of that: it needs four fields per property.
 *
 * Deactivated properties are deliberately KEPT. The assignment is a fact about
 * this Trip, and withdrawing a property from the catalog must not silently
 * change what an already-planned Trip is charged — refusing NEW assignments of
 * an inactive property is the write service's rule and stays there.
 * ────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class TripCustomPropertyReadService {
  constructor(
    private readonly repository: TripCustomPropertyReadRepository,
  ) {}

  /** The properties this Trip carries, in display order. Never the catalog. */
  async findByTripId(tripId: string): Promise<AssignedCustomPropertyView[]> {
    const rows = await this.repository.findByTripId(tripId);

    return rows.map(toAssignedView);
  }
}

function toAssignedView(
  row: TripCustomPropertyPricingRow,
): AssignedCustomPropertyView {
  return {
    customPropertyId: row.customProperty.id,
    name: row.customProperty.name,
    pricingComponentId: row.customProperty.pricingComponentId,
    defaultPrice:
      row.customProperty.defaultPrice === null
        ? null
        : row.customProperty.defaultPrice.toFixed(MONEY_DECIMAL_PLACES),
  };
}
