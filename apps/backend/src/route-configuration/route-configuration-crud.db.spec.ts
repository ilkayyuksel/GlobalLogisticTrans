import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  CombinationLegsSameRouteException,
  DuplicateActiveRouteException,
} from "../route-pricing/exceptions/route-pricing.exceptions";
import { TOLL_CODE, TUNNEL_CODE } from "./route-component-cost.service";
import {
  RouteConfigurationServices,
  RouteConfigurationUnitOfWork,
} from "./route-configuration.unit-of-work";

/**
 * Route price CRUD against a REAL database (owner's audit, 14 October 2026):
 * what is refused as a duplicate, what may stand side by side, and that the
 * list holds every route. Through the real configuration services.
 *
 * Opt-in: runs only when TEST_DATABASE_URL points at a throw-away database.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;

describeWithDatabase("route price CRUD against a real database", () => {
  let client: PrismaClient;
  let unitOfWork: RouteConfigurationUnitOfWork;

  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as AppLoggerService;

  beforeEach(async () => {
    client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: DATABASE_URL as string, max: 4 }),
    });
    unitOfWork = new RouteConfigurationUnitOfWork(client as unknown as PrismaService, logger);

    for (const code of [TOLL_CODE, TUNNEL_CODE]) {
      const component =
        (await client.pricingComponent.findFirst({ where: { code } })) ??
        (await client.pricingComponent.create({
          data: { code, name: code, description: "Seeded by a test", displayOrder: 90 },
        }));
      if (!(await client.customProperty.findFirst({ where: { pricingComponentId: component.id } }))) {
        await client.customProperty.create({
          data: { name: `${code} (test)`, pricingComponentId: component.id, displayOrder: 90 },
        });
      }
    }
  });

  afterEach(async () => {
    await client.$disconnect();
  });

  const run = <T>(work: (services: RouteConfigurationServices) => Promise<T>) => unitOfWork.run(work);
  const place = (label: string) => `${label} ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const road = (departure: string, destination: string, tarief = 100) => ({
    departure,
    destination,
    tarief,
    toll: 0,
    tunnel: 0,
  });

  it("22. refuses the same ordinary road in another case, naming the stored route", async () => {
    const city = place("Lokeren");
    await run((services) => services.routes.create(road("Quay 869", city)));

    const refusal = run((services) => services.routes.create(road("PSA Quay 869", city.toUpperCase())));

    await expect(refusal).rejects.toBeInstanceOf(DuplicateActiveRouteException);
    await expect(
      run((services) => services.routes.create(road("PSA Quay 869", city.toUpperCase()))),
    ).rejects.toThrow(`It is configured as "Quay 869" to "${city}"`);
  });

  it("21/23. an ordinary route and a Combination leg may share one road, either way round", async () => {
    const [ghlin, mons] = [place("Ghlin"), place("Mons")];
    await run((services) =>
      services.combinations.create({ legs: [road("Quay 869", ghlin, 150), road(mons, "Quay 869", 120)] }),
    );

    // The leg's road as an ordinary route: allowed.
    await run((services) => services.routes.create(road("Quay 869", ghlin, 200)));
    // And a second Combination sharing that leg with another return: allowed.
    await run((services) =>
      services.combinations.create({
        legs: [road("Quay 869", ghlin, 150), road(place("Bergen"), "Quay 869", 110)],
      }),
    );

    const rows = await client.routePricing.findMany({ where: { destination: ghlin } });
    expect(rows.map((row) => row.combinationGroupId === null).sort()).toEqual([false, false, true]);
  });

  it("24. refuses a Combination whose legs are one road in two spellings", async () => {
    const city = place("Kallo");

    await expect(
      run((services) =>
        services.combinations.create({ legs: [road("Quay 869", city), road("PSA Quay 869", city.toUpperCase())] }),
      ),
    ).rejects.toBeInstanceOf(CombinationLegsSameRouteException);
  });

  it("25/28. lists every ordinary route — more than 200 — exactly as stored", async () => {
    const prefix = place("Bulk");
    await client.routePricing.createMany({
      data: Array.from({ length: 205 }, (_v, index) => ({
        routeName: `${prefix} ${index}`,
        departure: `${prefix} ${index}`,
        destination: "Quay 869",
        basePrice: "10.00",
      })),
    });

    const listed = await run((services) => services.routes.findAll());
    const stored = await client.routePricing.count({ where: { combinationGroupId: null } });

    expect(listed).toHaveLength(stored);
    expect(listed.filter((route) => route.departure.startsWith(prefix))).toHaveLength(205);
  });
});
