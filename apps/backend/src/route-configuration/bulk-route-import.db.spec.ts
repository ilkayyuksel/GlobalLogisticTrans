import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { PrismaService } from "../prisma/prisma.service";
import { CombinationRoutePricingService } from "../route-pricing/combination-route-pricing.service";
import { RoutePricingRepository } from "../route-pricing/route-pricing.repository";
import { RoutePricingService } from "../route-pricing/route-pricing.service";
import { BulkRouteImportService } from "./bulk-route-import.service";
import { BulkRouteImportValidator } from "./bulk-route-import.validator";
import { TOLL_CODE, TUNNEL_CODE } from "./route-component-cost.service";
import {
  RouteConfigurationServices,
  RouteConfigurationUnitOfWork,
} from "./route-configuration.unit-of-work";

/**
 * The bulk import against a REAL database: what is stored, what is not, and
 * that a Combination which fails halfway leaves nothing behind.
 *
 * ── OPT-IN, AND DISPOSABLE ONLY ─────────────────────────────────────────────
 * Runs only when TEST_DATABASE_URL is set, and it WRITES rows: point it at a
 * throw-away database with the migrations applied, never at a real one.
 * ────────────────────────────────────────────────────────────────────────────
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;

/** The import's own transaction needs a connection while the pool serves reads. */
const POOL_SIZE = 4;

/**
 * The real unit of work, except that a Combination's create fails AFTER it has
 * written its group and both legs — the worst moment for a partial record.
 *
 * Also what proves nested transactions stay inside the unit of work's own: the
 * Combination create opens one, and PGlite — one session behind its socket —
 * would block a second transaction until this one timed out.
 */
class FailingAfterCombinationWrites extends RouteConfigurationUnitOfWork {
  override run<TResult>(work: (services: RouteConfigurationServices) => Promise<TResult>): Promise<TResult> {
    return super.run((services) =>
      work({
        ...services,
        combinations: Object.assign(Object.create(services.combinations), {
          create: async (dto: Parameters<RouteConfigurationServices["combinations"]["create"]>[0]) => {
            await services.combinations.create(dto);
            throw new Error("the disk filled up");
          },
        }),
      }),
    );
  }
}

describeWithDatabase("bulk route import against a real database", () => {
  let client: PrismaClient;
  let prisma: PrismaService;
  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as AppLoggerService;

  beforeEach(async () => {
    client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: DATABASE_URL as string, max: POOL_SIZE }),
    });
    prisma = client as unknown as PrismaService;
    await seedRouteComponents();
  });

  afterEach(async () => {
    await client.$disconnect();
  });

  /** TOLL and TUNNEL, each linked to a Custom Property as route-priced components are. */
  async function seedRouteComponents(): Promise<void> {
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
  }

  function importer(unitOfWork = new RouteConfigurationUnitOfWork(prisma, logger)): BulkRouteImportService {
    const repository = new RoutePricingRepository(prisma);

    return new BulkRouteImportService(
      new BulkRouteImportValidator(
        new RoutePricingService(repository, logger),
        new CombinationRoutePricingService(repository, logger),
        logger,
      ),
      unitOfWork,
      logger,
    );
  }

  /** A place name of this test's own, so no test sees another's routes. */
  const place = (label: string) => `${label} ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const normal = (departure: string, destination: string) => ({
    type: "NORMAL",
    departure,
    destination,
    tarief: 100,
    toll: 25,
    tunnel: 0,
  });
  const combination = (a: [string, string], b: [string, string]) => ({
    type: "COMBINATION",
    legs: [
      { departure: a[0], destination: a[1], tarief: 100, toll: 25, tunnel: 0 },
      { departure: b[0], destination: b[1], tarief: 80, toll: 30, tunnel: 15 },
    ],
  });

  const rowsFrom = (departures: string[]) =>
    client.routePricing.findMany({ where: { departure: { in: departures } } });

  it("1/2. stores every valid route and skips the Combination of one road twice", async () => {
    const [a, b, c] = [place("Antwerp"), place("Kallo"), place("Gent")];

    const result = await importer().import({
      routes: [normal(a, b), combination([a, b], [a, b]), combination([c, a], [a, c])],
    });

    expect(result.outcome).toBe("PARTIAL");
    expect(result.skipped.map((entry) => [entry.routeNumber, entry.reasons[0].code])).toEqual([
      [2, "SAME_ROUTE_LEGS"],
    ]);
    // One ordinary route, and the two legs of the valid Combination — nothing of route 2.
    const rows = await rowsFrom([a, c]);
    expect(rows).toHaveLength(3);
    expect(rows.filter((row) => row.combinationGroupId !== null)).toHaveLength(2);
  });

  it("7. skips a route that is already stored, without touching the stored one", async () => {
    const [a, b] = [place("Antwerp"), place("Kallo")];
    await importer().import({ routes: [normal(a, b)] });
    const [before] = await rowsFrom([a]);

    const result = await importer().import({
      routes: [{ ...normal(a, b), tarief: 999 }, normal(b, a)],
    });

    expect(result.outcome).toBe("PARTIAL");
    const after = await client.routePricing.findUnique({ where: { id: before.id } });
    expect(after?.basePrice.toString()).toBe(before.basePrice.toString());
  });

  it("10/11. a Combination that fails halfway leaves no group and no leg, and stops the import", async () => {
    const [a, b, c] = [place("Antwerp"), place("Kallo"), place("Gent")];

    const result = await importer(new FailingAfterCombinationWrites(prisma, logger)).import({
      routes: [normal(c, a), combination([a, b], [b, a]), normal(c, b)],
    });

    expect(result).toMatchObject({ outcome: "ABORTED", stoppedAt: { routeNumber: 2 }, notAttempted: 1 });
    // Read on a fresh connection: PGlite garbles reads after a failed transaction.
    await client.$disconnect();
    client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: DATABASE_URL as string, max: POOL_SIZE }),
    });
    const rows = await rowsFrom([a, b, c]);
    expect(rows.map((row) => [row.departure, row.destination])).toEqual([[c, a]]);
  });
});
