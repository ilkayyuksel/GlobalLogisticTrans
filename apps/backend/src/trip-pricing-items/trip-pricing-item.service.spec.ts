import { NotFoundException } from "@nestjs/common";
import { Prisma, TripPricingItem } from "@prisma/client";

import { CustomPropertyService } from "../custom-properties/custom-property.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { TripPricingService } from "../trip-pricing/trip-pricing.service";
import { CreateTripPricingItemDto } from "./dto/create-trip-pricing-item.dto";
import {
  DuplicateCustomPropertyItemException,
  InactivePricingComponentException,
  InvalidReferenceEntityException,
  TripPricingItemNotFoundException,
  UnknownPricingComponentException,
} from "./exceptions/trip-pricing-item.exceptions";
import { TripPricingItemRepository } from "./trip-pricing-item.repository";
import { TripPricingItemService } from "./trip-pricing-item.service";

const ITEM_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OTHER_ITEM_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";
const PRICING_ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const COMPONENT_ID = "2c9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const PROPERTY_ID = "4d9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";

function buildItem(overrides: Partial<TripPricingItem> = {}): TripPricingItem {
  return {
    id: ITEM_ID,
    tripPricingId: PRICING_ID,
    pricingComponentId: COMPONENT_ID,
    customPropertyId: null,
    description: "Fuel surcharge",
    amount: new Prisma.Decimal("57.25"),
    currency: "EUR",
    calculationOrder: 3,
    quantity: null,
    unitPrice: null,
    notes: null,
    createdAt: new Date("2026-08-11T09:15:00.000Z"),
    updatedAt: new Date("2026-08-11T09:15:00.000Z"),
    ...overrides,
  };
}

function buildCreateDto(
  overrides: Partial<CreateTripPricingItemDto> = {},
): CreateTripPricingItemDto {
  return {
    tripPricingId: PRICING_ID,
    pricingComponentId: COMPONENT_ID,
    description: "Fuel surcharge",
    amount: 57.25,
    calculationOrder: 3,
    ...overrides,
  };
}

describe("TripPricingItemService", () => {
  let repository: jest.Mocked<TripPricingItemRepository>;
  let tripPricingService: { findById: jest.Mock };
  let customPropertyService: { findById: jest.Mock };
  let logger: { setContext: jest.Mock; log: jest.Mock; warn: jest.Mock };
  let service: TripPricingItemService;

  beforeEach(() => {
    repository = {
      findById: jest.fn().mockResolvedValue(null),
      findByTripPricingId: jest.fn().mockResolvedValue([]),
      findByCustomProperty: jest.fn().mockResolvedValue(null),
      findPricingComponentById: jest
        .fn()
        .mockResolvedValue({ id: COMPONENT_ID, code: "FUEL_SURCHARGE", isActive: true }),
      create: jest.fn().mockResolvedValue(buildItem()),
      update: jest.fn().mockResolvedValue(buildItem()),
    } as unknown as jest.Mocked<TripPricingItemRepository>;

    tripPricingService = {
      findById: jest.fn().mockResolvedValue({ id: PRICING_ID }),
    };
    customPropertyService = {
      findById: jest
        .fn()
        .mockResolvedValue({ id: PROPERTY_ID, isActive: true }),
    };
    logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };

    service = new TripPricingItemService(
      repository,
      tripPricingService as unknown as TripPricingService,
      customPropertyService as unknown as CustomPropertyService,
      logger as unknown as AppLoggerService,
    );
  });

  describe("findByTripPricingId", () => {
    it("returns the breakdown of the snapshot", async () => {
      repository.findByTripPricingId.mockResolvedValue([buildItem()]);

      const result = await service.findByTripPricingId(PRICING_ID);

      expect(repository.findByTripPricingId).toHaveBeenCalledWith(PRICING_ID);
      expect(result.items).toHaveLength(1);
    });

    it("returns an empty breakdown when the snapshot has no lines", async () => {
      expect((await service.findByTripPricingId(PRICING_ID)).items).toEqual([]);
    });

    it("propagates the snapshot's 404 rather than reporting an empty breakdown", async () => {
      tripPricingService.findById.mockRejectedValue(new NotFoundException());

      await expect(
        service.findByTripPricingId(PRICING_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.findByTripPricingId).not.toHaveBeenCalled();
    });
  });

  describe("findById", () => {
    it("returns the item", async () => {
      repository.findById.mockResolvedValue(buildItem());

      expect((await service.findById(ITEM_ID)).id).toBe(ITEM_ID);
    });

    it("throws when the item does not exist", async () => {
      await expect(service.findById(ITEM_ID)).rejects.toBeInstanceOf(
        TripPricingItemNotFoundException,
      );
    });
  });

  describe("create", () => {
    it("stores every supplied value verbatim", async () => {
      await service.create(
        buildCreateDto({ quantity: 3, unitPrice: 19.5, notes: "checked" }),
      );

      expect(repository.create).toHaveBeenCalledWith({
        tripPricingId: PRICING_ID,
        pricingComponentId: COMPONENT_ID,
        customPropertyId: null,
        description: "Fuel surcharge",
        amount: 57.25,
        calculationOrder: 3,
        quantity: 3,
        unitPrice: 19.5,
        notes: "checked",
      });
    });

    it("never multiplies quantity by unit price to derive the amount", async () => {
      // 3 x 19.50 would be 58.50; the caller's 57.25 must survive untouched.
      await service.create(
        buildCreateDto({ quantity: 3, unitPrice: 19.5, amount: 57.25 }),
      );

      expect(repository.create.mock.calls[0][0].amount).toBe(57.25);
    });

    it("stores a negative amount, which the primary document allows", async () => {
      await service.create(buildCreateDto({ amount: -12.5 }));

      expect(repository.create.mock.calls[0][0].amount).toBe(-12.5);
    });

    it("never sets a currency, leaving the EUR column default to apply", async () => {
      await service.create(buildCreateDto());

      expect(repository.create.mock.calls[0][0]).not.toHaveProperty("currency");
    });

    it("normalises omitted optional fields to null rather than undefined", async () => {
      await service.create(buildCreateDto());

      const data = repository.create.mock.calls[0][0];

      expect(data.customPropertyId).toBeNull();
      expect(data.quantity).toBeNull();
      expect(data.unitPrice).toBeNull();
      expect(data.notes).toBeNull();
    });

    it("propagates the snapshot's 404 when it does not exist", async () => {
      tripPricingService.findById.mockRejectedValue(new NotFoundException());

      await expect(service.create(buildCreateDto())).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(repository.create).not.toHaveBeenCalled();
    });

    it("rejects an unknown pricing component", async () => {
      repository.findPricingComponentById.mockResolvedValue(null);

      await expect(service.create(buildCreateDto())).rejects.toBeInstanceOf(
        UnknownPricingComponentException,
      );
      expect(repository.create).not.toHaveBeenCalled();
    });

    it("rejects an inactive pricing component", async () => {
      repository.findPricingComponentById.mockResolvedValue({
        id: COMPONENT_ID,
        code: "FUEL_SURCHARGE",
        isActive: false,
      });

      await expect(service.create(buildCreateDto())).rejects.toBeInstanceOf(
        InactivePricingComponentException,
      );
    });

    describe("reference entity", () => {
      beforeEach(() => {
        repository.findPricingComponentById.mockResolvedValue({
          id: COMPONENT_ID,
          code: "CUSTOM_PROPERTY",
          isActive: true,
        });
      });

      it("accepts a custom property on a CUSTOM_PROPERTY item", async () => {
        await service.create(
          buildCreateDto({ customPropertyId: PROPERTY_ID }),
        );

        expect(repository.create.mock.calls[0][0].customPropertyId).toBe(
          PROPERTY_ID,
        );
      });

      it.each([
        "BASE_PRICE",
        "FUEL_SURCHARGE",
        "TOLL",
        "TUNNEL",
        "MANUAL_ADJUSTMENT",
      ])("rejects a custom property on a %s item", async (code) => {
        repository.findPricingComponentById.mockResolvedValue({
          id: COMPONENT_ID,
          code,
          isActive: true,
        });

        await expect(
          service.create(buildCreateDto({ customPropertyId: PROPERTY_ID })),
        ).rejects.toBeInstanceOf(InvalidReferenceEntityException);
        expect(repository.create).not.toHaveBeenCalled();
      });

      it("allows a CUSTOM_PROPERTY item without a reference, which is not required", async () => {
        await service.create(buildCreateDto());

        expect(repository.create).toHaveBeenCalled();
      });

      it("propagates the custom property's 404 when it does not exist", async () => {
        customPropertyService.findById.mockRejectedValue(
          new NotFoundException(),
        );

        await expect(
          service.create(buildCreateDto({ customPropertyId: PROPERTY_ID })),
        ).rejects.toBeInstanceOf(NotFoundException);
      });

      it("accepts an INACTIVE custom property, so historical Trips stay priceable", async () => {
        customPropertyService.findById.mockResolvedValue({
          id: PROPERTY_ID,
          isActive: false,
        });

        await service.create(buildCreateDto({ customPropertyId: PROPERTY_ID }));

        expect(repository.create).toHaveBeenCalled();
      });

      it("rejects the same custom property priced twice in one snapshot", async () => {
        repository.findByCustomProperty.mockResolvedValue(
          buildItem({ id: OTHER_ITEM_ID }),
        );

        await expect(
          service.create(buildCreateDto({ customPropertyId: PROPERTY_ID })),
        ).rejects.toBeInstanceOf(DuplicateCustomPropertyItemException);
        expect(repository.create).not.toHaveBeenCalled();
      });

      it("scopes the duplicate check to this snapshot only", async () => {
        await service.create(buildCreateDto({ customPropertyId: PROPERTY_ID }));

        expect(repository.findByCustomProperty).toHaveBeenCalledWith(
          PRICING_ID,
          PROPERTY_ID,
        );
      });
    });

    it("runs no duplicate or property lookup when no reference is supplied", async () => {
      await service.create(buildCreateDto());

      expect(customPropertyService.findById).not.toHaveBeenCalled();
      expect(repository.findByCustomProperty).not.toHaveBeenCalled();
    });

    it("logs identifiers and the order, never the amount or description", async () => {
      await service.create(
        buildCreateDto({ description: "Extra ferry cost EUR 45", amount: 45 }),
      );

      expect(logger.log).toHaveBeenCalledWith("Pricing item created", {
        tripPricingItemId: ITEM_ID,
        tripPricingId: PRICING_ID,
        pricingComponentId: COMPONENT_ID,
        customPropertyId: null,
        calculationOrder: 3,
      });
    });
  });

  describe("update", () => {
    beforeEach(() => {
      repository.findById.mockResolvedValue(buildItem());
    });

    it("throws when the item does not exist", async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.update(ITEM_ID, {})).rejects.toBeInstanceOf(
        TripPricingItemNotFoundException,
      );
    });

    it("writes only the note", async () => {
      await service.update(ITEM_ID, { notes: "verified with the customer" });

      expect(repository.update).toHaveBeenCalledWith(ITEM_ID, {
        notes: "verified with the customer",
      });
    });

    it("passes an explicit null through so the note is cleared", async () => {
      await service.update(ITEM_ID, { notes: null });

      expect(repository.update.mock.calls[0][1].notes).toBeNull();
    });

    it("leaves an omitted note undefined so Prisma does not touch it", async () => {
      await service.update(ITEM_ID, {});

      expect(repository.update).toHaveBeenCalledWith(ITEM_ID, {
        notes: undefined,
      });
    });

    it("never writes a calculated or provenance field", async () => {
      await service.update(ITEM_ID, { notes: "x" });

      const data = repository.update.mock.calls[0][1];

      expect(data).not.toHaveProperty("amount");
      expect(data).not.toHaveProperty("quantity");
      expect(data).not.toHaveProperty("unitPrice");
      expect(data).not.toHaveProperty("currency");
      expect(data).not.toHaveProperty("description");
      expect(data).not.toHaveProperty("calculationOrder");
      expect(data).not.toHaveProperty("pricingComponentId");
      expect(data).not.toHaveProperty("customPropertyId");
      expect(data).not.toHaveProperty("tripPricingId");
    });

    it("logs the changed field names but never their values", async () => {
      await service.update(ITEM_ID, { notes: "commercially sensitive" });

      expect(logger.log).toHaveBeenCalledWith("Pricing item notes updated", {
        tripPricingItemId: ITEM_ID,
        tripPricingId: PRICING_ID,
        changedFields: ["notes"],
      });
    });

    it("never re-validates the references, which cannot have moved", async () => {
      await service.update(ITEM_ID, { notes: "x" });

      expect(tripPricingService.findById).not.toHaveBeenCalled();
      expect(repository.findPricingComponentById).not.toHaveBeenCalled();
    });
  });

  describe("response shape", () => {
    it("renders the amount as a fixed two-decimal string", async () => {
      repository.findById.mockResolvedValue(
        buildItem({ amount: new Prisma.Decimal("57.2") }),
      );

      expect((await service.findById(ITEM_ID)).amount).toBe("57.20");
    });

    it("keeps a zero amount distinct from an absent one", async () => {
      repository.findById.mockResolvedValue(
        buildItem({ amount: new Prisma.Decimal("0") }),
      );

      expect((await service.findById(ITEM_ID)).amount).toBe("0.00");
    });

    it("renders a negative amount", async () => {
      repository.findById.mockResolvedValue(
        buildItem({ amount: new Prisma.Decimal("-12.5") }),
      );

      expect((await service.findById(ITEM_ID)).amount).toBe("-12.50");
    });

    it("renders quantity and unit price as strings, and null when absent", async () => {
      repository.findById.mockResolvedValue(
        buildItem({
          quantity: new Prisma.Decimal("3"),
          unitPrice: new Prisma.Decimal("19.5"),
        }),
      );

      const item = await service.findById(ITEM_ID);

      expect(item.quantity).toBe("3.00");
      expect(item.unitPrice).toBe("19.50");
    });

    it("keeps a zero quantity distinct from an absent one", async () => {
      repository.findById.mockResolvedValue(
        buildItem({ quantity: new Prisma.Decimal("0") }),
      );

      expect((await service.findById(ITEM_ID)).quantity).toBe("0.00");
    });

    it("returns null for an absent quantity and unit price", async () => {
      repository.findById.mockResolvedValue(buildItem());

      const item = await service.findById(ITEM_ID);

      expect(item.quantity).toBeNull();
      expect(item.unitPrice).toBeNull();
    });
  });

  it("contains no pricing arithmetic of any kind", () => {
    // The Pricing Engine owns every formula. This module must stay a store.
    const source = TripPricingItemService.prototype.constructor.toString();

    expect(source).not.toContain("reduce(");
    expect(source).not.toMatch(/amount\s*[*+/-]/);
    expect(source).not.toMatch(/quantity\s*\*/);
  });
});
