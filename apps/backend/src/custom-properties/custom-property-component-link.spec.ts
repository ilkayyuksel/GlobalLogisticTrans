import { CustomProperty, Prisma } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { CustomPropertyRepository } from "./custom-property.repository";
import { CustomPropertyService } from "./custom-property.service";
import {
  DuplicateComponentLinkException,
  DuplicateCustomPropertyNameException,
  LinkedPropertyMustHaveNoPriceException,
  UnknownPricingComponentException,
} from "./exceptions/custom-property.exceptions";

const PROPERTY_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OTHER_PROPERTY_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";
const COMPONENT_ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";

function buildProperty(
  overrides: Partial<CustomProperty> = {},
): CustomProperty {
  return {
    id: PROPERTY_ID,
    name: "TAR",
    description: null,
    pricingComponentId: null,
    defaultPrice: new Prisma.Decimal("35.00"),
    displayOrder: 1,
    color: "#f59e0b",
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function uniqueViolation(target: string) {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "7.0.0",
    meta: { target },
  });
}

/**
 * A property linked to a PricingComponent is ROUTE-PRICED: it decides only
 * whether that component applies to a Trip, and the amount comes from the route
 * cost configuration.
 *
 * Two rules govern the link, both from database_model.md section 4.12 and both
 * also enforced by the database — a linked property carries no price of its
 * own, and a component is reachable through at most one active property.
 */
describe("CustomPropertyService — pricing component link", () => {
  let repository: jest.Mocked<CustomPropertyRepository>;
  let logger: { setContext: jest.Mock; log: jest.Mock; warn: jest.Mock };
  let service: CustomPropertyService;

  beforeEach(() => {
    repository = {
      findPage: jest.fn().mockResolvedValue({ items: [], totalItems: 0 }),
      findById: jest.fn().mockResolvedValue(null),
      findActiveByName: jest.fn().mockResolvedValue(null),
      findActiveByPricingComponent: jest.fn().mockResolvedValue(null),
      pricingComponentExists: jest.fn().mockResolvedValue(true),
      findHighestDisplayOrder: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(buildProperty()),
      update: jest.fn().mockResolvedValue(buildProperty()),
      setActive: jest.fn().mockResolvedValue(buildProperty()),
      runInTransaction: jest.fn(),
    } as unknown as jest.Mocked<CustomPropertyRepository>;

    (repository.runInTransaction as jest.Mock).mockImplementation(
      (work: (repo: CustomPropertyRepository) => Promise<unknown>) =>
        work(repository),
    );

    logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };

    service = new CustomPropertyService(
      repository,
      logger as unknown as AppLoggerService,
    );
  });

  describe("create", () => {
    it("stores the link", async () => {
      await service.create({ name: "Toll", pricingComponentId: COMPONENT_ID });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          pricingComponentId: COMPONENT_ID,
          defaultPrice: null,
        }),
      );
    });

    it("stores null for a fixed-price property", async () => {
      await service.create({ name: "TAR", defaultPrice: 35 });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ pricingComponentId: null }),
      );
    });

    it("rejects a linked property that also carries a price", async () => {
      await expect(
        service.create({
          name: "Toll",
          pricingComponentId: COMPONENT_ID,
          defaultPrice: 10,
        }),
      ).rejects.toBeInstanceOf(LinkedPropertyMustHaveNoPriceException);

      expect(repository.create).not.toHaveBeenCalled();
    });

    it("rejects an unknown component", async () => {
      repository.pricingComponentExists.mockResolvedValue(false);

      await expect(
        service.create({ name: "Toll", pricingComponentId: COMPONENT_ID }),
      ).rejects.toBeInstanceOf(UnknownPricingComponentException);
    });

    it("rejects a component an active property already holds", async () => {
      repository.findActiveByPricingComponent.mockResolvedValue(
        buildProperty({ id: OTHER_PROPERTY_ID }),
      );

      await expect(
        service.create({ name: "Toll", pricingComponentId: COMPONENT_ID }),
      ).rejects.toBeInstanceOf(DuplicateComponentLinkException);
    });

    it("checks nothing about components for a fixed-price property", async () => {
      await service.create({ name: "TAR", defaultPrice: 35 });

      expect(repository.pricingComponentExists).not.toHaveBeenCalled();
      expect(repository.findActiveByPricingComponent).not.toHaveBeenCalled();
    });
  });

  describe("update", () => {
    it("rejects linking a property that keeps its price", async () => {
      // The rule reads the value the row will HOLD, not the one the request
      // mentions: the price is still there after this update.
      repository.findById.mockResolvedValue(
        buildProperty({ defaultPrice: new Prisma.Decimal("35.00") }),
      );

      await expect(
        service.update(PROPERTY_ID, { pricingComponentId: COMPONENT_ID }),
      ).rejects.toBeInstanceOf(LinkedPropertyMustHaveNoPriceException);
    });

    it("allows linking when the price is cleared in the same request", async () => {
      repository.findById.mockResolvedValue(
        buildProperty({ defaultPrice: new Prisma.Decimal("35.00") }),
      );

      await service.update(PROPERTY_ID, {
        pricingComponentId: COMPONENT_ID,
        defaultPrice: null,
      });

      expect(repository.update).toHaveBeenCalledWith(
        PROPERTY_ID,
        expect.objectContaining({
          pricingComponentId: COMPONENT_ID,
          defaultPrice: null,
        }),
      );
    });

    it("rejects adding a price to an already linked property", async () => {
      repository.findById.mockResolvedValue(
        buildProperty({ pricingComponentId: COMPONENT_ID, defaultPrice: null }),
      );

      await expect(
        service.update(PROPERTY_ID, { defaultPrice: 10 }),
      ).rejects.toBeInstanceOf(LinkedPropertyMustHaveNoPriceException);
    });

    it("allows unlinking, which makes the property fixed-price again", async () => {
      repository.findById.mockResolvedValue(
        buildProperty({ pricingComponentId: COMPONENT_ID, defaultPrice: null }),
      );

      await service.update(PROPERTY_ID, { pricingComponentId: null });

      expect(repository.update).toHaveBeenCalledWith(
        PROPERTY_ID,
        expect.objectContaining({ pricingComponentId: null }),
      );
    });

    it("does not re-check availability when the link does not move", async () => {
      repository.findById.mockResolvedValue(
        buildProperty({ pricingComponentId: COMPONENT_ID, defaultPrice: null }),
      );

      await service.update(PROPERTY_ID, { name: "Renamed" });

      expect(repository.findActiveByPricingComponent).not.toHaveBeenCalled();
    });

    it("rejects moving onto a component another active property holds", async () => {
      repository.findById.mockResolvedValue(
        buildProperty({ defaultPrice: null }),
      );
      repository.findActiveByPricingComponent.mockResolvedValue(
        buildProperty({ id: OTHER_PROPERTY_ID }),
      );

      await expect(
        service.update(PROPERTY_ID, { pricingComponentId: COMPONENT_ID }),
      ).rejects.toBeInstanceOf(DuplicateComponentLinkException);
    });
  });

  describe("activate", () => {
    it("rejects when the component was taken while inactive", async () => {
      repository.findById.mockResolvedValue(
        buildProperty({
          isActive: false,
          pricingComponentId: COMPONENT_ID,
          defaultPrice: null,
        }),
      );
      repository.findActiveByPricingComponent.mockResolvedValue(
        buildProperty({ id: OTHER_PROPERTY_ID }),
      );

      await expect(service.activate(PROPERTY_ID)).rejects.toBeInstanceOf(
        DuplicateComponentLinkException,
      );
      expect(repository.setActive).not.toHaveBeenCalled();
    });

    it("checks no component for an unlinked property", async () => {
      repository.findById.mockResolvedValue(buildProperty({ isActive: false }));

      await service.activate(PROPERTY_ID);

      expect(repository.findActiveByPricingComponent).not.toHaveBeenCalled();
    });
  });

  /**
   * Two partial unique indexes can fire on the same write. Guessing would tell
   * an administrator the name is taken when in fact the component is.
   */
  describe("unique-index violations name the right conflict", () => {
    it("reports a component conflict when that index fired", async () => {
      repository.create.mockRejectedValue(
        uniqueViolation("custom_property_pricing_component_active_key"),
      );

      await expect(
        service.create({ name: "Toll", pricingComponentId: COMPONENT_ID }),
      ).rejects.toBeInstanceOf(DuplicateComponentLinkException);
    });

    it("reports a name conflict when the name index fired", async () => {
      repository.create.mockRejectedValue(
        uniqueViolation("custom_property_name_active_key"),
      );

      await expect(
        service.create({ name: "Toll", pricingComponentId: COMPONENT_ID }),
      ).rejects.toBeInstanceOf(DuplicateCustomPropertyNameException);
    });

    it("reports a name conflict for an unlinked property", async () => {
      repository.create.mockRejectedValue(
        uniqueViolation("custom_property_name_active_key"),
      );

      await expect(
        service.create({ name: "TAR", defaultPrice: 35 }),
      ).rejects.toBeInstanceOf(DuplicateCustomPropertyNameException);
    });
  });

  it("never logs a price or a property name", async () => {
    await expect(
      service.create({
        name: "Toll",
        pricingComponentId: COMPONENT_ID,
        defaultPrice: 1234.56,
      }),
    ).rejects.toBeInstanceOf(LinkedPropertyMustHaveNoPriceException);

    const logged = JSON.stringify([
      ...logger.warn.mock.calls,
      ...logger.log.mock.calls,
    ]);

    expect(logged).not.toContain("1234.56");
    expect(logged).not.toContain("Toll");
  });
});
