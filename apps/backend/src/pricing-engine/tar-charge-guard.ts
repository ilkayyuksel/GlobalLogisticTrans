import { Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";
import { isHeldByAnother } from "./tar-charge-holders";
import { TarChargeReadRepository, type TarDay } from "./tar-charge-read.repository";

/**
 * The automatic TAR a snapshot write claims was charged to another Trip after
 * this calculation decided it was free. Never reaches a caller: the pricing is
 * repeated, and then finds the charge taken (`PairedPricingService`).
 */
export class AutomaticTarAlreadyChargedException extends Error {
  constructor(readonly tripId: string) {
    super(`The automatic TAR of Trip ${tripId} was charged to another Trip meanwhile.`);
    this.name = "AutomaticTarAlreadyChargedException";
  }
}

/**
 * ── AT MOST ONE AUTOMATIC TAR, UNDER REAL CONCURRENCY ───────────────────────
 * Whether a TAR-nummer is still free that day is decided while a Trip is
 * CALCULATED, and the charge is written later, when it is STORED. Two Trips
 * priced at the same moment in two database sessions could both decide "free"
 * and both commit a charge.
 *
 * So the write that carries an automatic TAR line decides again, inside its
 * own transaction and before anything else in it:
 *
 *   1. a transaction-scoped advisory lock on the number and day — a second
 *      write of the same number and day waits until the first commits or
 *      rolls back; writes of other numbers or days never wait;
 *   2. the day's holders, read under that lock (READ COMMITTED: the waiting
 *      write sees what the first committed);
 *   3. held by another Trip → the write is rolled back, nothing of it stored.
 *
 * The rule is the existing one — `tar-charge-holders.ts`, the same as the
 * calculation's own check — so the Trip that STORES first keeps the charge,
 * which is "the first Trip priced with it". The refused Trip is priced again
 * from its current data and stored without the automatic TAR.
 * ────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class TarChargeGuard {
  /** Runs first inside the snapshot write's transaction — see above. */
  async assertStillFree(transaction: PrismaService, day: TarDay, tripId: string): Promise<void> {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tarLockKey(day)}, 0))`;

    const holders = await new TarChargeReadRepository(transaction).findHolders(day);

    if (isHeldByAnother(holders, tripId)) {
      throw new AutomaticTarAlreadyChargedException(tripId);
    }
  }
}

/** One lock per number and day, the number compared as the reads compare it. */
export function tarLockKey(day: TarDay): string {
  return `tar-charge:${day.tarNummer.toLowerCase()}:${day.planningDate.toISOString().slice(0, 10)}`;
}
