import { Prisma } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import {
  ComponentNotRoutePricedException,
  DuplicateRouteCostException,
  RouteCostNotFoundException,
  UnknownPricingComponentException,
} from "./exceptions/route-cost.exceptions";
import {
  RouteCostRepository,
  RouteCostWithComponent,
} from "./route-cost.repository";
import { RouteCostService } from "./route-cost.service";

const ROUTE_COST_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const OTHER_ROUTE_COST_ID = "9c858901-8a57-4791-81fe-4c455b099bc9";
const TOLL_COMPONENT_ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const TUNNEL_COMPONENT_ID = "2c9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";

const TOLL_COMPONENT = {
  id: TOLL_COMPONENT_ID,
  code: "TOLL",
  name: "Toll",
};

const TUNNEL_COMPONENT = {
  id: TUNNEL_COMPONENT_ID,
  code: "TUNNEL",
  name: "Tunnel",
};

function buildRouteCost(
  overrides: Partial<RouteCostWithComponent> = {},
): RouteCostWithComponent {
  return {
    id: ROUTE_COST_ID,
    departure: "Antwerp Terminal",
    destination: "Rotterdam",
    pricingComponentId: TOLL_COMPONENT_ID,
    amount: new Prisma.Decimal("24.50"),
    notes: null,
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    pricingComponent: TOLL_COMPONENT,
    ...overrides,
  };
}

const VALID_CREATE = {
  departure: "Antwerp Terminal",
  destination: "Rotterdam",
  pricingComponentId: TOLL_COMPONENT_ID,
  amount: 24.5,
};

describe("RouteCostService", () => {
  let repository: jest.Mocked<RouteCostRepository>;
  let logger: { setContext: jest.Mock; log: jest.Mock; warn: jest.Mock };
  let service: RouteCostService;

  beforeEach(() => {
    repository = {
      findPage: jest.fn().mockResolvedValue({ items: [], totalItems: 0 }),
      findById: jest.fn().mockResolvedValue(null),
      findActiveByRouteAndComponent: jest.fn().mockResolvedValue(null),
      findPricingComponent: jest.fn().mockResolvedValue(TOLL_COMPONENT),
      isRoutePricedComponent: jest.fn().mockResolvedValue(true),
      create: jest.fn().mockResolvedValue(buildRouteCost()),
      update: jest.fn().mockResolvedValue(buildRouteCost()),
      setActive: jest.fn().mockResolvedValue(buildRouteCost()),
    } as unknown as jest.Mocked<RouteCostRepository>;

    logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };

    service = new RouteCostService(
      repository,
      logger as unknown as AppLoggerService,
    );
  });

  describe("findAll", () => {
    it("translates the page into skip and take", async () => {
      await service.findAll({ page: 3, pageSize: 20 });

      expect(repository.findPage).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 40, take: 20 }),
      );
    });

    it("passes every filter through", async () => {
      await service.findAll({
        page: 1,
        pageSize: 25,
        isActive: true,
        pricingComponentId: TOLL_COMPONENT_ID,
        search: "rotterdam",
      });

      expect(repository.findPage).toHaveBeenCalledWith({
        isActive: true,
        pricingComponentId: TOLL_COMPONENT_ID,
        search: "rotterdam",
        skip: 0,
        take: 25,
      });
    });

    it("returns amounts as fixed-decimal strings, never JSON numbers", async () => {
      repository.findPage.mockResolvedValue({
        items: [buildRouteCost({ amount: new Prisma.Decimal("24.5") })],
        totalItems: 1,
      });

      const { items } = await service.findAll({ page: 1, pageSize: 25 });

      expect(items[0].amount).toBe("24.50");
    });

    it("builds pagination metadata from the total", async () => {
      repository.findPage.mockResolvedValue({ items: [], totalItems: 42 });

      const { meta } = await service.findAll({ page: 1, pageSize: 25 });

      expect(meta.totalItems).toBe(42);
      expect(meta.totalPages).toBe(2);
    });
  });

  describe("findById", () => {
    it("returns the record with its component nested", async () => {
      repository.findById.mockResolvedValue(buildRouteCost());

      const result = await service.findById(ROUTE_COST_ID);

      expect(result.pricingComponent).toEqual(TOLL_COMPONENT);
      expect(result.pricingComponentId).toBe(TOLL_COMPONENT_ID);
    });

    it("throws when the record does not exist", async () => {
      await expect(service.findById(ROUTE_COST_ID)).rejects.toBeInstanceOf(
        RouteCostNotFoundException,
      );
    });
  });

  describe("create", () => {
    it("stores the supplied fields with notes defaulted to null", async () => {
      await service.create(VALID_CREATE);

      expect(repository.create).toHaveBeenCalledWith({
        departure: "Antwerp Terminal",
        destination: "Rotterdam",
        pricingComponentId: TOLL_COMPONENT_ID,
        amount: 24.5,
        notes: null,
      });
    });

    it("rejects an unknown component before writing anything", async () => {
      repository.findPricingComponent.mockResolvedValue(null);

      await expect(service.create(VALID_CREATE)).rejects.toBeInstanceOf(
        UnknownPricingComponentException,
      );
      expect(repository.create).not.toHaveBeenCalled();
    });

    /**
     * A component that no custom property links to resolves its amount from
     * somewhere else entirely — a route cost for it would never be read.
     */
    it("rejects a component that is not route-priced", async () => {
      repository.isRoutePricedComponent.mockResolvedValue(false);
      repository.findPricingComponent.mockResolvedValue({
        id: TOLL_COMPONENT_ID,
        code: "FUEL_SURCHARGE",
        name: "Fuel surcharge",
      });

      await expect(service.create(VALID_CREATE)).rejects.toBeInstanceOf(
        ComponentNotRoutePricedException,
      );
      expect(repository.create).not.toHaveBeenCalled();
    });

    it("names the rejected component in the message, not its id", async () => {
      repository.isRoutePricedComponent.mockResolvedValue(false);
      repository.findPricingComponent.mockResolvedValue({
        id: TOLL_COMPONENT_ID,
        code: "BASE_PRICE",
        name: "Base price",
      });

      await expect(service.create(VALID_CREATE)).rejects.toThrow("BASE_PRICE");
    });

    it("checks existence before route-pricing, so an unknown id is a 404", async () => {
      repository.findPricingComponent.mockResolvedValue(null);
      repository.isRoutePricedComponent.mockResolvedValue(false);

      await expect(service.create(VALID_CREATE)).rejects.toBeInstanceOf(
        UnknownPricingComponentException,
      );
      expect(repository.isRoutePricedComponent).not.toHaveBeenCalled();
    });

    it("rejects a duplicate active record for the same route and component", async () => {
      repository.findActiveByRouteAndComponent.mockResolvedValue(
        buildRouteCost({ id: OTHER_ROUTE_COST_ID }),
      );

      await expect(service.create(VALID_CREATE)).rejects.toBeInstanceOf(
        DuplicateRouteCostException,
      );
      expect(repository.create).not.toHaveBeenCalled();
    });

    it("scopes the duplicate check to all three identity fields", async () => {
      await service.create(VALID_CREATE);

      expect(repository.findActiveByRouteAndComponent).toHaveBeenCalledWith(
        "Antwerp Terminal",
        "Rotterdam",
        TOLL_COMPONENT_ID,
        undefined,
      );
    });

    it("allows the same route under a different component", async () => {
      // Toll and Tunnel are separate charges that can both apply to one route.
      repository.findPricingComponent.mockResolvedValue(TUNNEL_COMPONENT);

      await service.create({
        ...VALID_CREATE,
        pricingComponentId: TUNNEL_COMPONENT_ID,
      });

      expect(repository.create).toHaveBeenCalled();
    });

    it("translates the unique-index violation that wins a concurrent race", async () => {
      // The pre-check cannot be atomic; the partial index is the real guard.
      repository.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "7.0.0",
        }),
      );

      await expect(service.create(VALID_CREATE)).rejects.toBeInstanceOf(
        DuplicateRouteCostException,
      );
    });

    it("rethrows any other Prisma error untouched", async () => {
      const failure = new Prisma.PrismaClientKnownRequestError(
        "Foreign key constraint failed",
        { code: "P2003", clientVersion: "7.0.0" },
      );
      repository.create.mockRejectedValue(failure);

      await expect(service.create(VALID_CREATE)).rejects.toBe(failure);
    });
  });

  describe("update", () => {
    beforeEach(() => {
      repository.findById.mockResolvedValue(buildRouteCost());
    });

    it("passes the DTO through, so omitted fields stay untouched", async () => {
      await service.update(ROUTE_COST_ID, { amount: 30 });

      expect(repository.update).toHaveBeenCalledWith(ROUTE_COST_ID, {
        departure: undefined,
        destination: undefined,
        pricingComponentId: undefined,
        amount: 30,
        notes: undefined,
      });
    });

    it("re-checks uniqueness when the route moves", async () => {
      await service.update(ROUTE_COST_ID, { destination: "Utrecht" });

      expect(repository.findActiveByRouteAndComponent).toHaveBeenCalledWith(
        "Antwerp Terminal",
        "Utrecht",
        TOLL_COMPONENT_ID,
        ROUTE_COST_ID,
      );
    });

    it("re-checks uniqueness when the component moves", async () => {
      repository.findPricingComponent.mockResolvedValue(TUNNEL_COMPONENT);

      await service.update(ROUTE_COST_ID, {
        pricingComponentId: TUNNEL_COMPONENT_ID,
      });

      expect(repository.findActiveByRouteAndComponent).toHaveBeenCalledWith(
        "Antwerp Terminal",
        "Rotterdam",
        TUNNEL_COMPONENT_ID,
        ROUTE_COST_ID,
      );
    });

    it("does not re-check when only the amount changes", async () => {
      await service.update(ROUTE_COST_ID, { amount: 30 });

      expect(repository.findActiveByRouteAndComponent).not.toHaveBeenCalled();
    });

    /**
     * An inactive row cannot collide with the active-only index, so moving it is
     * always allowed; activation re-checks.
     */
    it("does not re-check while the record is inactive", async () => {
      repository.findById.mockResolvedValue(buildRouteCost({ isActive: false }));

      await service.update(ROUTE_COST_ID, { destination: "Utrecht" });

      expect(repository.findActiveByRouteAndComponent).not.toHaveBeenCalled();
    });

    it("rejects a move onto a route and component another active record holds", async () => {
      repository.findActiveByRouteAndComponent.mockResolvedValue(
        buildRouteCost({ id: OTHER_ROUTE_COST_ID }),
      );

      await expect(
        service.update(ROUTE_COST_ID, { destination: "Utrecht" }),
      ).rejects.toBeInstanceOf(DuplicateRouteCostException);
      expect(repository.update).not.toHaveBeenCalled();
    });

    it("validates a component only when it actually moves", async () => {
      await service.update(ROUTE_COST_ID, { amount: 30 });

      expect(repository.findPricingComponent).not.toHaveBeenCalled();
      expect(repository.isRoutePricedComponent).not.toHaveBeenCalled();
    });

    it("rejects moving onto a component that is not route-priced", async () => {
      repository.findPricingComponent.mockResolvedValue({
        id: TUNNEL_COMPONENT_ID,
        code: "WAITING_TIME",
        name: "Waiting time",
      });
      repository.isRoutePricedComponent.mockResolvedValue(false);

      await expect(
        service.update(ROUTE_COST_ID, {
          pricingComponentId: TUNNEL_COMPONENT_ID,
        }),
      ).rejects.toBeInstanceOf(ComponentNotRoutePricedException);
    });

    it("rejects moving onto a component that does not exist", async () => {
      repository.findPricingComponent.mockResolvedValue(null);

      await expect(
        service.update(ROUTE_COST_ID, {
          pricingComponentId: TUNNEL_COMPONENT_ID,
        }),
      ).rejects.toBeInstanceOf(UnknownPricingComponentException);
    });

    it("throws when the record does not exist", async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.update(ROUTE_COST_ID, { amount: 30 }),
      ).rejects.toBeInstanceOf(RouteCostNotFoundException);
    });

    it("clears notes when null is sent explicitly", async () => {
      await service.update(ROUTE_COST_ID, { notes: null });

      expect(repository.update).toHaveBeenCalledWith(
        ROUTE_COST_ID,
        expect.objectContaining({ notes: null }),
      );
    });
  });

  describe("activate", () => {
    it("re-checks uniqueness, because the route may have been taken", async () => {
      repository.findById.mockResolvedValue(buildRouteCost({ isActive: false }));

      await service.activate(ROUTE_COST_ID);

      expect(repository.findActiveByRouteAndComponent).toHaveBeenCalledWith(
        "Antwerp Terminal",
        "Rotterdam",
        TOLL_COMPONENT_ID,
        ROUTE_COST_ID,
      );
      expect(repository.setActive).toHaveBeenCalledWith(ROUTE_COST_ID, true);
    });

    it("rejects activation when another active record now covers it", async () => {
      repository.findById.mockResolvedValue(buildRouteCost({ isActive: false }));
      repository.findActiveByRouteAndComponent.mockResolvedValue(
        buildRouteCost({ id: OTHER_ROUTE_COST_ID }),
      );

      await expect(service.activate(ROUTE_COST_ID)).rejects.toBeInstanceOf(
        DuplicateRouteCostException,
      );
      expect(repository.setActive).not.toHaveBeenCalled();
    });

    it("is idempotent for an already active record", async () => {
      repository.findById.mockResolvedValue(buildRouteCost());

      await service.activate(ROUTE_COST_ID);

      expect(repository.setActive).not.toHaveBeenCalled();
      expect(repository.findActiveByRouteAndComponent).not.toHaveBeenCalled();
    });

    it("does not re-validate that the component is still route-priced", async () => {
      // Unlinking the custom property must not strand an existing record.
      repository.findById.mockResolvedValue(buildRouteCost({ isActive: false }));

      await service.activate(ROUTE_COST_ID);

      expect(repository.isRoutePricedComponent).not.toHaveBeenCalled();
    });
  });

  describe("deactivate", () => {
    it("deactivates without any further check", async () => {
      repository.findById.mockResolvedValue(buildRouteCost());

      await service.deactivate(ROUTE_COST_ID);

      expect(repository.setActive).toHaveBeenCalledWith(ROUTE_COST_ID, false);
      expect(repository.findActiveByRouteAndComponent).not.toHaveBeenCalled();
    });

    /**
     * Historical TripPricingItem rows hold frozen amounts, so withdrawing the
     * configuration can never invalidate them.
     */
    it("is never blocked by historical pricing", async () => {
      repository.findById.mockResolvedValue(buildRouteCost());

      await expect(service.deactivate(ROUTE_COST_ID)).resolves.toBeDefined();
    });

    it("is idempotent for an already inactive record", async () => {
      repository.findById.mockResolvedValue(buildRouteCost({ isActive: false }));

      await service.deactivate(ROUTE_COST_ID);

      expect(repository.setActive).not.toHaveBeenCalled();
    });

    it("throws when the record does not exist", async () => {
      await expect(service.deactivate(ROUTE_COST_ID)).rejects.toBeInstanceOf(
        RouteCostNotFoundException,
      );
    });
  });

  describe("logging", () => {
    it("logs identifiers only, never the amount or the route", async () => {
      await service.create({ ...VALID_CREATE, amount: 1234.56 });

      expect(logger.log).toHaveBeenCalledWith("Route cost created", {
        routeCostId: ROUTE_COST_ID,
        pricingComponentId: TOLL_COMPONENT_ID,
      });

      const logged = JSON.stringify([
        ...logger.log.mock.calls,
        ...logger.warn.mock.calls,
      ]);

      expect(logged).not.toContain("1234.56");
      expect(logged).not.toContain("Antwerp");
    });

    it("logs the changed field names on update, not their values", async () => {
      repository.findById.mockResolvedValue(buildRouteCost());

      await service.update(ROUTE_COST_ID, { amount: 999.99, notes: "tariff" });

      expect(logger.log).toHaveBeenCalledWith("Route cost updated", {
        routeCostId: ROUTE_COST_ID,
        changedFields: ["amount", "notes"],
      });

      const logged = JSON.stringify(logger.log.mock.calls);

      expect(logged).not.toContain("999.99");
      expect(logged).not.toContain("tariff");
    });

    it("logs no amount when rejecting a duplicate", async () => {
      repository.findActiveByRouteAndComponent.mockResolvedValue(
        buildRouteCost({ id: OTHER_ROUTE_COST_ID }),
      );

      await expect(
        service.create({ ...VALID_CREATE, amount: 1234.56 }),
      ).rejects.toBeInstanceOf(DuplicateRouteCostException);

      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("1234.56");
    });
  });

  it("never calculates and never touches a pricing snapshot", () => {
    const source = RouteCostService.prototype.constructor.toString();

    expect(source).not.toContain("reduce(");
    expect(source).not.toContain("tripPricing");
    expect(source).not.toContain("Decimal");
  });
});
