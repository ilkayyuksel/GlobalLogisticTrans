import { PrismaPg } from "@prisma/adapter-pg";
import { CustomProperty, Prisma, PrismaClient } from "@prisma/client";

import { violatesUniqueConstraint } from "../common/unique-violation";
import { AppLoggerService } from "../logger/app-logger.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  DuplicateComponentLinkException,
  DuplicateCustomPropertyNameException,
} from "./exceptions/custom-property.exceptions";
import { CustomPropertyRepository } from "./custom-property.repository";
import { CustomPropertyService } from "./custom-property.service";

/**
 * Which unique index refused a Custom Property, as a REAL database reports it.
 *
 * ── WHY A DATABASE ──────────────────────────────────────────────────────────
 * Two partial unique indexes guard `custom_property`: the active NAME and the
 * active PRICING COMPONENT link. The service checks both first, so the indexes
 * only fire when two writes race past those checks — and then the service must
 * say WHICH one fired. That depends entirely on the error shape the real
 * Prisma client and `pg` driver adapter produce, which only a real database
 * can show.
 *
 * ── OPT-IN, AND DISPOSABLE ONLY ─────────────────────────────────────────────
 * Runs only when TEST_DATABASE_URL is set, and it WRITES rows: point it at a
 * throw-away database with the migrations applied, never at a real one. See
 * `cost-confirmation.concurrency.db.spec.ts` for how one was provided.
 * ────────────────────────────────────────────────────────────────────────────
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;

/**
 * The service's own checks, as they look to the LOSER of a race: the other
 * write has not committed yet, so both checks find nothing and the insert is
 * left to the database. Every read and write is otherwise the real one.
 */
class RaceLosingRepository extends CustomPropertyRepository {
  override findActiveByName(): Promise<CustomProperty | null> {
    return Promise.resolve(null);
  }

  override findActiveByPricingComponent(): Promise<CustomProperty | null> {
    return Promise.resolve(null);
  }
}

describeWithDatabase("CustomPropertyService against a real database", () => {
  let client: PrismaClient;
  let prisma: PrismaService;
  let service: CustomPropertyService;

  /*
   * A fresh client — so a fresh connection — for every test. PGlite, used when
   * this was written, is one Postgres session behind its socket server, and a
   * connection that has seen an error inside a transaction returns garbled
   * rows afterwards. Each test below ends in exactly one expected refusal, so
   * one connection per test keeps every test independent of the others.
   */
  beforeEach(() => {
    client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: DATABASE_URL as string, max: 1 }),
    });
    prisma = client as unknown as PrismaService;
    service = new CustomPropertyService(new RaceLosingRepository(prisma), {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as AppLoggerService);
  });

  afterEach(async () => {
    await client.$disconnect();
  });

  const unique = (label: string) =>
    `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  /** A Pricing Component of this test's own, so no test sees another's link. */
  async function seedComponent(): Promise<string> {
    const [{ id }] = await client.$queryRaw<{ id: string }[]>`
      INSERT INTO pricing_component (code, name, description, display_order, is_active)
      VALUES (${unique("TEST")}, 'Test component', 'Seeded by a test', 99, true)
      RETURNING id`;

    return id;
  }

  it("reports the COMPONENT link when the component index refuses", async () => {
    const pricingComponentId = await seedComponent();
    await service.create({ name: unique("Toll A"), pricingComponentId });

    await expect(
      service.create({ name: unique("Toll B"), pricingComponentId }),
    ).rejects.toBeInstanceOf(DuplicateComponentLinkException);
  });

  it("reports the NAME when the name index refuses", async () => {
    const name = unique("Genset");
    await service.create({ name, defaultPrice: 35 });

    await expect(service.create({ name, defaultPrice: 35 })).rejects.toBeInstanceOf(
      DuplicateCustomPropertyNameException,
    );
  });

  /*
   * Both indexes would refuse this one. Postgres checks them in its own
   * order and reports the first — whichever it is, the answer must name the
   * index that actually fired, never a guess.
   */
  it("names one of the two real conflicts when both apply", async () => {
    const pricingComponentId = await seedComponent();
    const name = unique("Tunnel");
    await service.create({ name, pricingComponentId });

    const refusal = await service
      .create({ name, pricingComponentId })
      .catch((error: unknown) => error);

    expect(
      refusal instanceof DuplicateComponentLinkException ||
        refusal instanceof DuplicateCustomPropertyNameException,
    ).toBe(true);
  });

  /*
   * Any other unique conflict is not one of these two, and must not be
   * reported as a taken name: here the primary key.
   */
  it("does not report another unique conflict as a taken name", async () => {
    const repository = new CustomPropertyRepository(prisma);
    const existing = await repository.create({ name: unique("Primary"), displayOrder: 1 });

    const conflict = await repository
      .create({ id: existing.id, name: unique("Other"), displayOrder: 2 })
      .catch((error: unknown) => error);

    expect(conflict).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((conflict as Prisma.PrismaClientKnownRequestError).code).toBe("P2002");
    // Recorded so the shape the adapter really produces is visible in the run.
    expect((conflict as Prisma.PrismaClientKnownRequestError).meta).toMatchObject({
      driverAdapterError: { cause: { constraint: { fields: ["id"] } } },
    });
    expect((conflict as Prisma.PrismaClientKnownRequestError).meta).not.toHaveProperty(
      "target",
    );
    expect(
      violatesUniqueConstraint(conflict, {
        columns: ["name"],
        indexName: "custom_property_name_active_key",
      }),
    ).toBe(false);
  });
});
