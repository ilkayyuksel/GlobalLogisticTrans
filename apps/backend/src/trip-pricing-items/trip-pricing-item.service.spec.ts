import { NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import type { TripPricingItemWithComponent } from "./dto/trip-pricing-item-response.dto";

import { AppLoggerService } from "../logger/app-logger.service";
import { TripPricingService } from "../trip-pricing/trip-pricing.service";
import { TripPricingItemNotFoundException } from "./exceptions/trip-pricing-item.exceptions";
import { TripPricingItemRepository } from "./trip-pricing-item.repository";
import { TripPricingItemService } from "./trip-pricing-item.service";

const ITEM_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const PRICING_ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const COMPONENT_ID = "2c9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";

function buildItem(
  overrides: Partial<TripPricingItemWithComponent> = {},
): TripPricingItemWithComponent {
  return {
    // Loaded with the line: the code is what says a line IS a fuel
    // surcharge rather than a toll.
    pricingComponent: { code: "BASE_PRICE" },
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

describe("TripPricingItemService", () => {
  let repository: jest.Mocked<TripPricingItemRepository>;
  let tripPricingService: { findById: jest.Mock };
  let logger: { setContext: jest.Mock; log: jest.Mock; warn: jest.Mock };
  let service: TripPricingItemService;

  beforeEach(() => {
    repository = {
      findById: jest.fn().mockResolvedValue(null),
      findByTripPricingId: jest.fn().mockResolvedValue([]),
      findPricingComponentById: jest
        .fn()
        .mockResolvedValue({ id: COMPONENT_ID, code: "FUEL_SURCHARGE", isActive: true }),
      update: jest.fn().mockResolvedValue(buildItem()),
    } as unknown as jest.Mocked<TripPricingItemRepository>;

    tripPricingService = {
      findById: jest.fn().mockResolvedValue({ id: PRICING_ID }),
    };
    logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };

    service = new TripPricingItemService(
      repository,
      tripPricingService as unknown as TripPricingService,
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
