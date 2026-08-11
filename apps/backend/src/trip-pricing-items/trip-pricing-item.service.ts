import { Injectable } from "@nestjs/common";
import { TripPricingItem } from "@prisma/client";

import { changedFieldNames } from "../common/changed-fields";
import { CustomPropertyService } from "../custom-properties/custom-property.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { TripPricingService } from "../trip-pricing/trip-pricing.service";
import { CreateTripPricingItemDto } from "./dto/create-trip-pricing-item.dto";
import {
  TripPricingBreakdownDto,
  TripPricingItemResponseDto,
  toTripPricingItemResponse,
} from "./dto/trip-pricing-item-response.dto";
import { UpdateTripPricingItemDto } from "./dto/update-trip-pricing-item.dto";
import {
  DuplicateCustomPropertyItemException,
  InactivePricingComponentException,
  InvalidReferenceEntityException,
  TripPricingItemNotFoundException,
  UnknownPricingComponentException,
} from "./exceptions/trip-pricing-item.exceptions";
import {
  PricingComponentClassification,
  TripPricingItemRepository,
} from "./trip-pricing-item.repository";

/**
 * The component code that may carry a Custom Property as its Reference Entity.
 *
 * `pricing_component.code` is TEXT because the catalog is database-driven, but
 * database_schema.md §8.2 requires this component to be seeded, so the code is
 * a documented contract rather than an incidental value.
 */
const CUSTOM_PROPERTY_COMPONENT_CODE = "CUSTOM_PROPERTY";

/**
 * Stores the individual lines of a pricing breakdown. It never calculates one.
 *
 * The future Pricing Engine performs the arithmetic and calls this module to
 * persist each line; every amount, quantity, unit price and calculation order
 * arrives from the caller and is written verbatim. There is no formula, no
 * multiplication of quantity by unit price and no summation here, and there
 * must never be — pricing logic belongs in exactly one place.
 *
 * The module also never touches its neighbours: it does not update the parent
 * snapshot's total, and it does not touch the Trip. Both are read-only
 * dependencies, so a breakdown can never silently rewrite the result it
 * explains.
 *
 * Monetary values are never written to the log. Only identifiers and the
 * calculation order are, which is enough to trace a line without exposing what
 * it is worth.
 */
@Injectable()
export class TripPricingItemService {
  constructor(
    private readonly repository: TripPricingItemRepository,
    private readonly tripPricingService: TripPricingService,
    private readonly customPropertyService: CustomPropertyService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(TripPricingItemService.name);
  }

  /**
   * The complete breakdown of one snapshot, in calculation order.
   *
   * The snapshot's existence is verified first, so an unknown parent is
   * reported as 404 rather than as an empty breakdown — the two mean very
   * different things when a total is being explained.
   */
  async findByTripPricingId(
    tripPricingId: string,
  ): Promise<TripPricingBreakdownDto> {
    await this.tripPricingService.findById(tripPricingId);

    const items = await this.repository.findByTripPricingId(tripPricingId);

    return { items: items.map(toTripPricingItemResponse) };
  }

  async findById(id: string): Promise<TripPricingItemResponseDto> {
    return toTripPricingItemResponse(await this.requireItem(id));
  }

  /**
   * Persists one line produced by the Pricing Engine.
   *
   * Every reference is verified before the write, so a rejected request never
   * leaves a line pointing at something that does not exist. The foreign keys
   * remain the final guard.
   */
  async create(
    dto: CreateTripPricingItemDto,
  ): Promise<TripPricingItemResponseDto> {
    await this.tripPricingService.findById(dto.tripPricingId);

    const component = await this.requireActiveComponent(dto.pricingComponentId);

    await this.assertReferenceEntityValid(dto, component);

    const created = await this.repository.create({
      tripPricingId: dto.tripPricingId,
      pricingComponentId: dto.pricingComponentId,
      customPropertyId: dto.customPropertyId ?? null,
      description: dto.description,
      amount: dto.amount,
      calculationOrder: dto.calculationOrder,
      quantity: dto.quantity ?? null,
      unitPrice: dto.unitPrice ?? null,
      notes: dto.notes ?? null,
    });

    // The amount is never logged: it is commercial information.
    this.logger.log("Pricing item created", {
      tripPricingItemId: created.id,
      tripPricingId: created.tripPricingId,
      pricingComponentId: created.pricingComponentId,
      customPropertyId: created.customPropertyId,
      calculationOrder: created.calculationOrder,
    });

    return toTripPricingItemResponse(created);
  }

  /**
   * Updates the note, and nothing else.
   *
   * The DTO exposes only `notes`, so the calculated values and their provenance
   * cannot move. In particular the parent's total stays consistent with the sum
   * of its lines, because no line's amount can change here.
   */
  async update(
    id: string,
    dto: UpdateTripPricingItemDto,
  ): Promise<TripPricingItemResponseDto> {
    const existing = await this.requireItem(id);

    const updated = await this.repository.update(id, { notes: dto.notes });

    this.logger.log("Pricing item notes updated", {
      tripPricingItemId: id,
      tripPricingId: existing.tripPricingId,
      changedFields: changedFieldNames(dto),
    });

    return toTripPricingItemResponse(updated);
  }

  private async requireItem(id: string): Promise<TripPricingItem> {
    const item = await this.repository.findById(id);

    if (!item) {
      throw new TripPricingItemNotFoundException(id);
    }

    return item;
  }

  /**
   * The classifying component must exist and be active.
   *
   * database_schema.md §8.2: an inactive component cannot be used for a new
   * calculation, while historical items keep referencing the one they were
   * created with.
   */
  private async requireActiveComponent(
    pricingComponentId: string,
  ): Promise<PricingComponentClassification> {
    const component =
      await this.repository.findPricingComponentById(pricingComponentId);

    if (!component) {
      throw new UnknownPricingComponentException(pricingComponentId);
    }

    if (!component.isActive) {
      this.logger.warn("Rejected pricing item for an inactive component", {
        pricingComponentId,
      });

      throw new InactivePricingComponentException(pricingComponentId);
    }

    return component;
  }

  /**
   * Validates the optional Reference Entity.
   *
   * Three separate things must hold: the referenced Custom Property exists, the
   * item is classified as a Custom Property line, and the same property is not
   * already priced in this snapshot.
   *
   * The property itself need not still be active. A Trip keeps the properties
   * it was assigned even after they are withdrawn from use, and pricing a
   * historical Trip must remain possible.
   */
  private async assertReferenceEntityValid(
    dto: CreateTripPricingItemDto,
    component: PricingComponentClassification,
  ): Promise<void> {
    if (!dto.customPropertyId) {
      return;
    }

    if (component.code !== CUSTOM_PROPERTY_COMPONENT_CODE) {
      this.logger.warn("Rejected reference entity on a mismatched component", {
        pricingComponentId: component.id,
        componentCode: component.code,
      });

      throw new InvalidReferenceEntityException(
        component.code,
        CUSTOM_PROPERTY_COMPONENT_CODE,
      );
    }

    // Delegating existence to CustomPropertyService reuses its lookup and its
    // 404 rather than duplicating either here.
    await this.customPropertyService.findById(dto.customPropertyId);

    await this.assertCustomPropertyNotAlreadyPriced(
      dto.tripPricingId,
      dto.customPropertyId,
    );
  }

  /**
   * A Trip cannot carry the same Custom Property twice, so its breakdown must
   * not charge for it twice.
   *
   * Enforced here only: the schema carries no unique index on the pair, because
   * every other kind of line may legitimately repeat.
   */
  private async assertCustomPropertyNotAlreadyPriced(
    tripPricingId: string,
    customPropertyId: string,
  ): Promise<void> {
    const existing = await this.repository.findByCustomProperty(
      tripPricingId,
      customPropertyId,
    );

    if (existing) {
      this.logger.warn("Rejected duplicate custom property pricing item", {
        tripPricingId,
        customPropertyId,
        conflictingItemId: existing.id,
      });

      throw new DuplicateCustomPropertyItemException(
        customPropertyId,
        existing.id,
      );
    }
  }
}
