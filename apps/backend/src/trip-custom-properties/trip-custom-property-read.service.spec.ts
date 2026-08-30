import { Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { TripCustomPropertyReadRepository } from "./trip-custom-property-read.repository";
import { TripCustomPropertyReadService } from "./trip-custom-property-read.service";

const TRIP_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

/**
 * The narrow assignment read side.
 *
 * Four fields per property, because those are the four a price depends on: what
 * it is, what it is called, whether it is route-priced, and — when it is not —
 * what it costs. The assignment row's own id, its timestamp and its provenance
 * are absent, and that absence is the design: a calculator that could see
 * `isAutomatic` could charge a rule-assigned property differently from a
 * hand-assigned one, which is a rule nobody wrote.
 */
function buildRow(
  overrides: Record<string, unknown> = {},
  property: Record<string, unknown> = {},
) {
  return {
    customProperty: {
      id: "property-flat",
      name: "Flat",
      pricingComponentId: null,
      defaultPrice: new Prisma.Decimal("80.00"),
      ...property,
    },
    ...overrides,
  };
}

describe("TripCustomPropertyReadRepository", () => {
  let prisma: { tripCustomProperty: { findMany: jest.Mock } };
  let repository: TripCustomPropertyReadRepository;

  beforeEach(() => {
    prisma = { tripCustomProperty: { findMany: jest.fn().mockResolvedValue([]) } };

    repository = new TripCustomPropertyReadRepository(
      prisma as unknown as PrismaService,
    );
  });

  it("reads this Trip's assignments, never the catalog", async () => {
    await repository.findByTripId(TRIP_ID);

    expect(prisma.tripCustomProperty.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tripId: TRIP_ID } }),
    );
  });

  /**
   * The configured display order, which is the order the whole application
   * uses — so a stored breakdown lists its Custom Property lines the same way
   * the planning screen lists the assignments that produced them. `id` breaks
   * ties, because display order is not unique.
   */
  it("returns them in the configured display order", async () => {
    await repository.findByTripId(TRIP_ID);

    const [{ orderBy }] = prisma.tripCustomProperty.findMany.mock.calls[0];

    expect(orderBy).toEqual([
      { customProperty: { displayOrder: "asc" } },
      { id: "asc" },
    ]);
  });

  it("selects only the four fields a price depends on", async () => {
    await repository.findByTripId(TRIP_ID);

    const [{ select }] = prisma.tripCustomProperty.findMany.mock.calls[0];

    expect(Object.keys(select)).toEqual(["customProperty"]);
    expect(Object.keys(select.customProperty.select).sort()).toEqual([
      "defaultPrice",
      "id",
      "name",
      "pricingComponentId",
    ]);
  });
});

describe("TripCustomPropertyReadService", () => {
  let repository: { findByTripId: jest.Mock };
  let service: TripCustomPropertyReadService;

  beforeEach(() => {
    repository = { findByTripId: jest.fn().mockResolvedValue([buildRow()]) };

    service = new TripCustomPropertyReadService(
      repository as unknown as TripCustomPropertyReadRepository,
    );
  });

  it("returns a fixed-price property with its configured amount", async () => {
    expect(await service.findByTripId(TRIP_ID)).toEqual([
      {
        customPropertyId: "property-flat",
        name: "Flat",
        pricingComponentId: null,
        defaultPrice: "80.00",
      },
    ]);
  });

  /**
   * A route-priced property declares only that its component APPLIES; the
   * amount lives in the route cost configuration, so it carries no price of its
   * own and the database enforces that.
   */
  it("returns a route-priced property with no price of its own", async () => {
    repository.findByTripId.mockResolvedValue([
      buildRow(
        {},
        {
          id: "property-toll",
          name: "Toll",
          pricingComponentId: "component-toll",
          defaultPrice: null,
        },
      ),
    ]);

    expect(await service.findByTripId(TRIP_ID)).toEqual([
      {
        customPropertyId: "property-toll",
        name: "Toll",
        pricingComponentId: "component-toll",
        defaultPrice: null,
      },
    ]);
  });

  it("renders the price as exact decimal text, never a float", async () => {
    repository.findByTripId.mockResolvedValue([
      buildRow({}, { defaultPrice: new Prisma.Decimal("20") }),
    ]);

    expect((await service.findByTripId(TRIP_ID))[0].defaultPrice).toBe("20.00");
  });

  it("answers an empty list for a Trip carrying nothing", async () => {
    repository.findByTripId.mockResolvedValue([]);

    expect(await service.findByTripId(TRIP_ID)).toEqual([]);
  });
});
