import { Driver, Trip, VehicleAssignment } from "@prisma/client";

import { CostConfirmationService } from "../cost-confirmations/cost-confirmation.service";
import { EffectivePricingService } from "../trip-pricing/effective-pricing.service";
import { DriverService } from "../drivers/driver.service";
import { DriverStatisticsService } from "../trips/driver-statistics.service";
import { EffectiveDriverSource } from "../trips/dto/trip-response.dto";
import { AppLoggerService } from "../logger/app-logger.service";
import { TripPlanningDataService } from "../trips/trip-planning-data.service";
import { TripRepository } from "../trips/trip.repository";
import { UpdateVehicleAssignmentDto } from "./dto/update-vehicle-assignment.dto";
import { VehicleAssignmentOverlapException } from "./exceptions/vehicle-assignment.exceptions";
import { VehicleAssignmentRepository } from "./vehicle-assignment.repository";
import { VehicleAssignmentService } from "./vehicle-assignment.service";
import { VehicleService } from "../vehicles/vehicle.service";

/**
 * Giving a vehicle a different driver, without changing who drove it before.
 *
 * ── THE RULE THESE TESTS EXIST FOR ──────────────────────────────────────────
 * A vehicle carries different drivers over time. Changing "the driver" is never
 * an edit of the current assignment: it CLOSES that period and OPENS a new one.
 * Piet drove the truck in August, Ahmet drives it from the 24th, and a Trip
 * planned on the 10th still belongs to Piet — for as long as that Trip exists,
 * and no matter how often the truck changes hands afterwards.
 *
 * The alternative — moving the driver on the existing row — is silent and
 * total: it would rewrite months of finished work, every invoice built on it
 * and every statistic derived from it, with no record that it happened.
 *
 * These tests therefore run the REAL service against an in-memory repository
 * rather than asserting on mock calls, and then feed what it actually stored
 * into the REAL effective-driver resolver and the REAL statistics service. What
 * is under test is the outcome for a Trip, which is the only thing an operator
 * ever sees.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Today is pinned to Tuesday 25 August 2026 — a week running Mon 24 to Sun 30
 * inside a month running 1 to 31 — so the statistics windows are facts rather
 * than whatever day the suite happens to run on.
 */

const TODAY = "2026-08-25";

const VEHICLE_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const PIET = "bbbbbbbb-2222-4222-8222-222222222222";
const AHMET = "cccccccc-3333-4333-8333-333333333333";
const RESERVE = "dddddddd-4444-4444-8444-444444444444";

const NAMES: Record<string, string> = {
  [PIET]: "Piet Janssens",
  [AHMET]: "Ahmet Yilmaz",
  [RESERVE]: "Marc Vermeulen",
};

/** The day Ahmet takes over. Piet's period must end the day before. */
const HANDOVER = "2026-08-24";
const DAY_BEFORE_HANDOVER = "2026-08-23";

function day(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function driver(id: string): Driver {
  return { id, name: NAMES[id], isActive: true } as Driver;
}

function trip(id: string, planningDate: string, overrideDriverId?: string): Trip {
  return {
    id,
    planningDate: day(planningDate),
    vehicleId: VEHICLE_ID,
    driverId: overrideDriverId ?? null,
  } as unknown as Trip;
}

/**
 * The assignment table, in memory.
 *
 * Faithful to the queries the real repository issues — in particular the
 * overlap predicate, since "does this period collide" is the rule that decides
 * whether a reassignment is allowed at all. It stores rows and answers
 * questions; every decision stays in the service, where it belongs.
 */
class InMemoryAssignmentRepository {
  readonly rows: VehicleAssignment[] = [];
  private sequence = 0;

  runInTransaction<TResult>(
    work: (repository: VehicleAssignmentRepository) => Promise<TResult>,
  ): Promise<TResult> {
    return work(this as unknown as VehicleAssignmentRepository);
  }

  findById(id: string): Promise<VehicleAssignment | null> {
    return Promise.resolve(this.rows.find((row) => row.id === id) ?? null);
  }

  findOpenEndedForVehicle(vehicleId: string): Promise<VehicleAssignment | null> {
    return Promise.resolve(
      this.rows.find(
        (row) => row.vehicleId === vehicleId && row.validTo === null,
      ) ?? null,
    );
  }

  findOpenEndedForDriver(driverId: string): Promise<VehicleAssignment | null> {
    return Promise.resolve(
      this.rows.find((row) => row.driverId === driverId && row.validTo === null) ??
        null,
    );
  }

  /** Two periods overlap unless one ends before the other starts. */
  findOverlapping(query: {
    vehicleId?: string;
    driverId?: string;
    validFrom: Date;
    validTo: Date | null;
    excludeAssignmentId?: string;
  }): Promise<VehicleAssignment[]> {
    return Promise.resolve(
      this.rows.filter((row) => {
        if (query.vehicleId && row.vehicleId !== query.vehicleId) return false;
        if (query.driverId && row.driverId !== query.driverId) return false;
        if (query.excludeAssignmentId === row.id) return false;

        const startsAfterCandidateEnds =
          query.validTo !== null &&
          row.validFrom.getTime() > query.validTo.getTime();
        const endsBeforeCandidateStarts =
          row.validTo !== null &&
          row.validTo.getTime() < query.validFrom.getTime();

        return !startsAfterCandidateEnds && !endsBeforeCandidateStarts;
      }),
    );
  }

  findCoveringVehicles(
    vehicleIds: readonly string[],
    from: Date,
    to: Date,
  ): Promise<(VehicleAssignment & { driver: Driver })[]> {
    return Promise.resolve(
      this.rows
        .filter(
          (row) =>
            vehicleIds.includes(row.vehicleId) &&
            row.validFrom.getTime() <= to.getTime() &&
            (row.validTo === null || row.validTo.getTime() >= from.getTime()),
        )
        .map((row) => ({ ...row, driver: driver(row.driverId) })),
    );
  }

  create(data: {
    vehicleId: string;
    driverId: string;
    validFrom: Date;
    validTo: Date | null;
    notes: string | null;
  }): Promise<VehicleAssignment> {
    this.sequence += 1;

    const row = {
      id: `assignment-${this.sequence}`,
      ...data,
      createdAt: day(TODAY),
      updatedAt: day(TODAY),
    } as VehicleAssignment;

    this.rows.push(row);

    return Promise.resolve(row);
  }

  update(
    id: string,
    data: { validTo?: Date | null; notes?: string | null },
  ): Promise<VehicleAssignment> {
    const row = this.require(id);

    if (data.validTo !== undefined) row.validTo = data.validTo;
    if (data.notes !== undefined) row.notes = data.notes;

    return Promise.resolve(row);
  }

  setValidTo(id: string, validTo: Date | null): Promise<VehicleAssignment> {
    const row = this.require(id);
    row.validTo = validTo;

    return Promise.resolve(row);
  }

  findPage(): Promise<{ items: VehicleAssignment[]; totalItems: number }> {
    return Promise.resolve({ items: [...this.rows], totalItems: this.rows.length });
  }

  findCurrentForVehicle(): Promise<VehicleAssignment | null> {
    return Promise.resolve(null);
  }

  findCurrentForDriver(): Promise<VehicleAssignment | null> {
    return Promise.resolve(null);
  }

  private require(id: string): VehicleAssignment {
    const row = this.rows.find((candidate) => candidate.id === id);

    if (!row) {
      throw new Error(`No assignment ${id}`);
    }

    return row;
  }
}

describe("changing the driver of a vehicle", () => {
  let repository: InMemoryAssignmentRepository;
  let assignments: VehicleAssignmentService;
  let planningData: TripPlanningDataService;
  let logger: jest.Mocked<AppLoggerService>;

  /** Trips the statistics service will be given for the current window. */
  let windowTrips: Trip[];

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(`${TODAY}T09:30:00.000Z`));

    repository = new InMemoryAssignmentRepository();
    windowTrips = [];

    logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    } as unknown as jest.Mocked<AppLoggerService>;

    assignments = new VehicleAssignmentService(
      repository as unknown as VehicleAssignmentRepository,
      {
        findById: jest.fn().mockResolvedValue({ id: VEHICLE_ID }),
      } as unknown as VehicleService,
      {
        findById: jest.fn((id: string) => Promise.resolve(driver(id))),
      } as unknown as DriverService,
      logger,
    );

    planningData = new TripPlanningDataService(
      {
        findManyByIds: jest.fn().mockResolvedValue(new Map()),
      } as unknown as VehicleService,
      {
        // Only the OVERRIDE column is looked up here; assignments go the
        // other way, through the assignment service.
        findManyByIds: jest.fn((ids: string[]) =>
          Promise.resolve(new Map(ids.map((id) => [id, driver(id)]))),
        ),
      } as unknown as DriverService,
      assignments,
      {
        findCustomPropertiesForTrips: jest.fn().mockResolvedValue([]),
        findAppliedUpdateHistory: jest.fn().mockResolvedValue([]),
      } as unknown as TripRepository,
      {
        findForTrips: jest.fn().mockResolvedValue(new Map()),
      } as unknown as CostConfirmationService,
      {
        findForTrips: () => Promise.resolve(new Map()),
      } as unknown as EffectivePricingService,    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /** Piet, from 1 August, open-ended. The state before anything changes. */
  async function givenPietFromAugustFirst(): Promise<void> {
    await assignments.create({
      vehicleId: VEHICLE_ID,
      driverId: PIET,
      validFrom: "2026-08-01",
      validTo: null,
      notes: null,
    });
  }

  /** The operator hands the truck to Ahmet on the 24th. */
  function reassignToAhmet(): Promise<unknown> {
    return assignments.create({
      vehicleId: VEHICLE_ID,
      driverId: AHMET,
      validFrom: HANDOVER,
      validTo: null,
      notes: null,
    });
  }

  async function effectiveDriverOf(subject: Trip) {
    const resolved = await planningData.resolveOne(subject);

    return resolved.effectiveDriver;
  }

  describe("the two assignments it leaves behind", () => {
    beforeEach(async () => {
      await givenPietFromAugustFirst();
      await reassignToAhmet();
    });

    it("keeps both periods, rather than replacing one", () => {
      expect(repository.rows).toHaveLength(2);
    });

    /** The heart of it: Piet's row still says Piet. */
    it("leaves the previous driver on the previous assignment", () => {
      const [previous] = repository.rows;

      expect(previous.driverId).toBe(PIET);
      expect(previous.validFrom).toEqual(day("2026-08-01"));
    });

    it("ends the previous period the day before the new one starts", () => {
      const [previous] = repository.rows;

      expect(previous.validTo).toEqual(day(DAY_BEFORE_HANDOVER));
    });

    it("starts the new period on the day the operator gave", () => {
      const [, current] = repository.rows;

      expect(current).toMatchObject({
        driverId: AHMET,
        validTo: null,
      });
      expect(current.validFrom).toEqual(day(HANDOVER));
    });

    /** No gap and no overlap: every day of August has exactly one driver. */
    it("leaves the two periods touching", () => {
      const [previous, current] = repository.rows;

      expect(previous.validTo?.getTime()).toBe(
        current.validFrom.getTime() - 24 * 60 * 60 * 1000,
      );
    });
  });

  describe("what the Trips resolve to afterwards", () => {
    let before: Trip;
    let after: Trip;
    let onHandoverDay: Trip;
    let onLastDayOfPiet: Trip;

    beforeEach(async () => {
      before = trip("trip-before", "2026-08-10");
      onLastDayOfPiet = trip("trip-boundary-piet", DAY_BEFORE_HANDOVER);
      onHandoverDay = trip("trip-boundary-ahmet", HANDOVER);
      after = trip("trip-after", "2026-08-25");

      await givenPietFromAugustFirst();
      await reassignToAhmet();
    });

    it("still gives the earlier Trip its original driver", async () => {
      expect(await effectiveDriverOf(before)).toMatchObject({
        id: PIET,
        name: NAMES[PIET],
        source: EffectiveDriverSource.VehicleAssignment,
      });
    });

    it("gives the later Trip the new driver", async () => {
      expect(await effectiveDriverOf(after)).toMatchObject({
        id: AHMET,
        source: EffectiveDriverSource.VehicleAssignment,
      });
    });

    /*
     * The boundary in both directions. An off-by-one here is invisible in
     * normal use and wrong on exactly one day per handover.
     */
    it("gives the day before the handover to the previous driver", async () => {
      expect(await effectiveDriverOf(onLastDayOfPiet)).toMatchObject({
        id: PIET,
      });
    });

    it("gives the handover day itself to the new driver", async () => {
      expect(await effectiveDriverOf(onHandoverDay)).toMatchObject({
        id: AHMET,
      });
    });

    /**
     * The Trip rows are not touched. Resolution reads the assignment table on
     * every request, so nothing has to be — and nothing may be, since a Trip
     * that stored its driver would freeze an answer that is still being
     * corrected elsewhere.
     */
    it("does not write the resolved driver back onto the Trip", async () => {
      await planningData.resolveMany([before, after]);

      expect(before.driverId).toBeNull();
      expect(after.driverId).toBeNull();
    });

    it("resolves a whole page of mixed dates in one pass", async () => {
      const resolved = await planningData.resolveMany([
        before,
        onLastDayOfPiet,
        onHandoverDay,
        after,
      ]);

      expect(resolved.get("trip-before")?.effectiveDriver?.id).toBe(PIET);
      expect(resolved.get("trip-boundary-piet")?.effectiveDriver?.id).toBe(PIET);
      expect(resolved.get("trip-boundary-ahmet")?.effectiveDriver?.id).toBe(AHMET);
      expect(resolved.get("trip-after")?.effectiveDriver?.id).toBe(AHMET);
    });
  });

  describe("a Trip that names its own driver", () => {
    /**
     * The override is the planner's decision about ONE Trip — someone stood in
     * that day. A change to the vehicle's standing arrangement says nothing
     * about it, and must not disturb it in either direction.
     */
    it("keeps the override after the vehicle is reassigned", async () => {
      const overridden = trip("trip-override", "2026-08-25", RESERVE);

      await givenPietFromAugustFirst();
      await reassignToAhmet();

      expect(await effectiveDriverOf(overridden)).toMatchObject({
        id: RESERVE,
        source: EffectiveDriverSource.Override,
      });
    });

    it("keeps an override on a Trip from before the handover", async () => {
      const overridden = trip("trip-override-old", "2026-08-10", RESERVE);

      await givenPietFromAugustFirst();
      await reassignToAhmet();

      expect(await effectiveDriverOf(overridden)).toMatchObject({
        id: RESERVE,
        source: EffectiveDriverSource.Override,
      });
    });
  });

  describe("what the reassignment refuses to do", () => {
    it("refuses a start date inside the period the vehicle already has", async () => {
      await givenPietFromAugustFirst();

      // Piet's period is closed manually first, so there is nothing open-ended
      // to auto-close and the new period genuinely collides.
      await assignments.end(repository.rows[0].id, { validTo: "2026-09-30" });

      await expect(
        assignments.create({
          vehicleId: VEHICLE_ID,
          driverId: AHMET,
          validFrom: HANDOVER,
          validTo: null,
          notes: null,
        }),
      ).rejects.toThrow(VehicleAssignmentOverlapException);

      // And it left the existing period exactly as it was.
      expect(repository.rows).toHaveLength(1);
      expect(repository.rows[0].driverId).toBe(PIET);
    });

    /**
     * `update` is the endpoint behind "Toewijzing bewerken". It carries no
     * driver at all — which is the guarantee, not an omission — so the only way
     * to change a driver is to create a period, and history cannot be edited by
     * a form that never had the field.
     */
    it("ignores a driver smuggled into an assignment update", async () => {
      await givenPietFromAugustFirst();
      const [existing] = repository.rows;

      // What a caller bypassing the UI would send. The DTO has no such field,
      // so it never reaches the repository — and the period keeps its driver.
      await assignments.update(existing.id, {
        notes: "handover agreed",
        driverId: AHMET,
      } as UpdateVehicleAssignmentDto);

      expect(existing.driverId).toBe(PIET);
      expect(existing.notes).toBe("handover agreed");
    });
  });

  /**
   * The Dashboard counts per driver.
   *
   * It asks the same resolver, so the month's counts follow the same history:
   * Piet's Trip from the 10th stays Piet's, and reassigning the truck does not
   * move it to Ahmet. A `GROUP BY driver_id` would have been simpler and would
   * have counted the override column instead — which is why the service does
   * not do that, and why this is tested through it rather than beside it.
   */
  describe("the driver statistics afterwards", () => {
    let statistics: DriverStatisticsService;

    beforeEach(() => {
      statistics = new DriverStatisticsService(
        {
          findByPlanningDateRange: jest.fn(() => Promise.resolve(windowTrips)),
        } as unknown as TripRepository,
        planningData,
        {
          findAll: jest.fn().mockResolvedValue({
            items: [driver(PIET), driver(AHMET)],
            meta: { page: 1, pageSize: 200, totalItems: 2, totalPages: 1 },
          }),
        } as unknown as DriverService,
      );
    });

    async function countsAfterReassignment() {
      windowTrips = [
        trip("trip-10-aug", "2026-08-10"),
        trip("trip-11-aug", "2026-08-11"),
        trip("trip-25-aug", "2026-08-25"),
      ];

      await givenPietFromAugustFirst();
      await reassignToAhmet();

      const result = await statistics.findAll();

      return new Map(result.drivers.map((entry) => [entry.driverId, entry]));
    }

    it("leaves the earlier Trips counted under the previous driver", async () => {
      const counts = await countsAfterReassignment();

      expect(counts.get(PIET)).toMatchObject({ month: 2, week: 0, today: 0 });
    });

    it("counts only the later Trip under the new driver", async () => {
      const counts = await countsAfterReassignment();

      expect(counts.get(AHMET)).toMatchObject({ month: 1, week: 1, today: 1 });
    });

    /** The total is unchanged: work moved to nobody, it only got attributed. */
    it("does not lose or duplicate any Trip", async () => {
      const counts = await countsAfterReassignment();

      const total = [...counts.values()].reduce(
        (sum, entry) => sum + entry.month,
        0,
      );

      expect(total).toBe(3);
    });
  });
});
