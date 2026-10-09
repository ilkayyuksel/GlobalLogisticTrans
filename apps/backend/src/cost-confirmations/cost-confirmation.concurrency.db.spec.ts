import { PrismaPg } from "@prisma/adapter-pg";
import { CostConfirmation, Prisma, PrismaClient } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { stubPricingRecalculation } from "../pricing-engine/pricing-recalculation.double";
import { PrismaService } from "../prisma/prisma.service";
import {
  CostConfirmationRepository,
  violatesConfirmationIdentity,
} from "./cost-confirmation.repository";
import { CostConfirmationReadRepository } from "./cost-confirmation-read.repository";
import { CostConfirmationReadService } from "./cost-confirmation-read.service";
import { CostConfirmationService } from "./cost-confirmation.service";

/**
 * Two imports of the same Cost Confirmation, at the same moment, against a REAL
 * Postgres with every migration applied.
 *
 * ── WHY A DATABASE ──────────────────────────────────────────────────────────
 * The race is between two statements on two connections: both read "not
 * recorded yet", both insert. Only the database's unique index can settle it,
 * and only a real Prisma client over the real `pg` adapter produces the error
 * shape the service has to recognise. An in-memory double proves neither.
 *
 * ── OPT-IN, AND DISPOSABLE ONLY ─────────────────────────────────────────────
 * Runs only when TEST_DATABASE_URL is set, and it WRITES rows: point it at a
 * throw-away database with the migrations applied, never at a real one. Any
 * Postgres works; no container is required — an in-process PGlite behind its
 * socket server was used when this was written.
 * ────────────────────────────────────────────────────────────────────────────
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;

/** Separate clients, so the attempts really travel on separate connections. */
const CONCURRENT_IMPORTS = 6;

/**
 * Makes the race certain instead of likely.
 *
 * Each import's FIRST read — "is this number recorded yet?" — is held until
 * every import has made it, so all of them see nothing and all of them insert.
 * The reads, the inserts, the unique index and the errors are all real; only
 * the timing is forced. Later reads (the winner lookup) pass straight through.
 */
function raceBarrier(parties: number) {
  let arrived = 0;
  let release!: () => void;
  const allArrived = new Promise<void>((resolve) => (release = resolve));

  return async (): Promise<void> => {
    arrived += 1;
    if (arrived === parties) {
      release();
    }
    await allArrived;
  };
}

class RacingRepository extends CostConfirmationRepository {
  private hasWaited = false;

  constructor(
    prisma: PrismaService,
    private readonly barrier: () => Promise<void>,
  ) {
    super(prisma);
  }

  override async findAllByTrip(tripId: string): Promise<CostConfirmation[]> {
    const rows = await super.findAllByTrip(tripId);

    if (!this.hasWaited) {
      this.hasWaited = true;
      await this.barrier();
    }

    return rows;
  }
}

describeWithDatabase("CostConfirmationService against a real database", () => {
  let clients: PrismaClient[];
  let logger: {
    setContext: jest.Mock;
    log: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
  };

  beforeAll(() => {
    clients = Array.from(
      { length: CONCURRENT_IMPORTS },
      () =>
        new PrismaClient({
          adapter: new PrismaPg({ connectionString: DATABASE_URL as string }),
        }),
    );
  });

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.$disconnect()));
  });

  beforeEach(() => {
    logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  });

  function serviceOn(client: PrismaClient, barrier?: () => Promise<void>) {
    const recalculation = stubPricingRecalculation();
    const prisma = client as unknown as PrismaService;

    return {
      recalculation,
      service: new CostConfirmationService(
        barrier
          ? new RacingRepository(prisma, barrier)
          : new CostConfirmationRepository(prisma),
        recalculation,
        logger as unknown as AppLoggerService,
      ),
    };
  }

  /** One import per client, all of them past the check before any inserts. */
  function racingImports() {
    const barrier = raceBarrier(CONCURRENT_IMPORTS);

    return clients.map((client) => serviceOn(client, barrier));
  }

  /** A Trip and a document of its own, so no test sees another's rows. */
  async function seedTrip(status = "OPEN"): Promise<{ tripId: string; pdfDocumentId: string }> {
    const client = clients[0];
    const [{ id: pdfDocumentId }] = await client.$queryRaw<{ id: string }[]>`
      INSERT INTO pdf_document (import_source, original_filename, storage_path, file_size_bytes, file_hash, mime_type)
      VALUES ('MANUAL_UPLOAD', 'cc.pdf', ${`test/${Date.now()}-${Math.random()}`}, 1, 'hash', 'application/pdf')
      RETURNING id`;
    const [{ id: tripId }] = await client.$queryRaw<{ id: string }[]>`
      INSERT INTO trip (booking_number, status)
      VALUES (${`ANRDUB-${Date.now()}-${Math.random()}`}, ${status}::"trip_status")
      RETURNING id`;

    return { tripId, pdfDocumentId };
  }

  function command(tripId: string, pdfDocumentId: string, ccNumber = "4132482") {
    return {
      tripId,
      pdfDocumentId,
      ccNumber,
      costCode: "WAIT",
      amount: "25.00",
      currency: "EUR",
      receivedAt: new Date(),
    };
  }

  async function rowsFor(tripId: string): Promise<CostConfirmation[]> {
    return clients[0].costConfirmation.findMany({ where: { tripId } });
  }

  it("5/6. records ONE row when the same confirmation is imported concurrently", async () => {
    const { tripId, pdfDocumentId } = await seedTrip();
    const attempts = racingImports();

    const results = await Promise.all(
      attempts.map(({ service }) => service.record(command(tripId, pdfDocumentId))),
    );

    expect(await rowsFor(tripId)).toHaveLength(1);
    expect(results.filter((result) => result.outcome === "RECORDED")).toHaveLength(1);
    expect(results.filter((result) => result.outcome === "ALREADY_RECORDED")).toHaveLength(
      CONCURRENT_IMPORTS - 1,
    );
    // Every answer names the one stored row.
    const [stored] = await rowsFor(tripId);
    for (const result of results) {
      expect(result.confirmation?.id).toBe(stored.id);
    }
    // Repriced once — by the import that wrote.
    const recalculations = attempts.reduce(
      (count, { recalculation }) => count + recalculation.recalculate.mock.calls.length,
      0,
    );
    expect(recalculations).toBe(1);
  });

  /*
   * Proof that the race above is real and not merely a sequence: every import
   * but one passed the "already recorded?" check and was then refused by the
   * index, which is the only way to reach this log line.
   */
  it("reaches the database's refusal, not only the service's own check", async () => {
    const { tripId, pdfDocumentId } = await seedTrip();

    await Promise.all(
      racingImports().map(({ service }) => service.record(command(tripId, pdfDocumentId))),
    );

    expect(logger.warn).toHaveBeenCalledTimes(CONCURRENT_IMPORTS - 1);
    expect(logger.warn).toHaveBeenCalledWith(
      "Cost confirmation recorded concurrently by another import",
      expect.objectContaining({ tripId, ccNumber: "4132482" }),
    );
  });

  it("2. records for a CANCELLED Trip and leaves its status alone", async () => {
    const { tripId, pdfDocumentId } = await seedTrip("CANCELLED");

    await Promise.all(
      racingImports().map(({ service }) => service.record(command(tripId, pdfDocumentId))),
    );

    expect(await rowsFor(tripId)).toHaveLength(1);
    const trip = await clients[0].trip.findUniqueOrThrow({ where: { id: tripId } });
    expect(trip.status).toBe("CANCELLED");
  });

  it("4/11. keeps different numbers for one Trip apart, even concurrently", async () => {
    const { tripId, pdfDocumentId } = await seedTrip();
    const numbers = ["4132482", "4139509", "4152218"];
    const barrier = raceBarrier(numbers.length);

    await Promise.all(
      numbers.map((ccNumber, index) =>
        serviceOn(clients[index], barrier).service.record(
          command(tripId, pdfDocumentId, ccNumber),
        ),
      ),
    );

    expect((await rowsFor(tripId)).map((row) => row.ccNumber).sort()).toEqual(numbers);
  });

  it("7. does not take another unique conflict for a duplicate confirmation", async () => {
    const { tripId, pdfDocumentId } = await seedTrip();
    const repository = new CostConfirmationRepository(clients[0] as unknown as PrismaService);
    const first = await repository.create(command(tripId, pdfDocumentId, "1"));

    // The same primary key, a different number: P2002 on `id`, not on the identity.
    const error = await repository
      .create({ ...command(tripId, pdfDocumentId, "2"), id: first.id })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((error as Prisma.PrismaClientKnownRequestError).code).toBe("P2002");
    expect(violatesConfirmationIdentity(error)).toBe(false);
  });

  it("recognises the identity conflict in the shape the real adapter reports", async () => {
    const { tripId, pdfDocumentId } = await seedTrip();
    const repository = new CostConfirmationRepository(clients[0] as unknown as PrismaService);
    await repository.create(command(tripId, pdfDocumentId));

    const error = await repository
      .create(command(tripId, pdfDocumentId))
      .catch((caught: unknown) => caught);

    expect(violatesConfirmationIdentity(error)).toBe(true);
  });

  /*
   * The export names a Trip's confirmations from these records, whatever its
   * status. Newest first, each number once, per Trip — in one query.
   */
  it("reads every Trip's confirmation numbers, newest first", async () => {
    const first = await seedTrip("OPEN");
    const second = await seedTrip("CLOSED");
    const repository = new CostConfirmationRepository(clients[0] as unknown as PrismaService);
    const at = (minute: number) => new Date(Date.UTC(2026, 9, 1, 8, minute));

    await repository.create({ ...command(first.tripId, first.pdfDocumentId, "4132482"), receivedAt: at(1) });
    await repository.create({ ...command(first.tripId, first.pdfDocumentId, "4139509"), receivedAt: at(5) });
    await repository.create({ ...command(second.tripId, second.pdfDocumentId, "4152218"), receivedAt: at(3) });

    const numbers = await new CostConfirmationReadService(
      new CostConfirmationReadRepository(clients[0] as unknown as PrismaService),
    ).findNumbersForTrips([first.tripId, second.tripId]);

    expect(numbers.get(first.tripId)).toEqual(["4139509", "4132482"]);
    expect(numbers.get(second.tripId)).toEqual(["4152218"]);
  });

  it("8. surfaces an ordinary database error instead of reporting success", async () => {
    const { pdfDocumentId } = await seedTrip();
    const { service } = serviceOn(clients[0]);

    // A Trip that does not exist: a foreign-key failure, not a duplicate.
    await expect(
      service.record(command("00000000-0000-4000-8000-000000000000", pdfDocumentId)),
    ).rejects.toMatchObject({ code: "P2003" });
  });
});
