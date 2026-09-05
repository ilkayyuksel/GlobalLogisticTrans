import { Trip, TripStatus } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { TripRepository } from "./trip.repository";
import { TripService } from "./trip.service";

/**
 * One TAR-nummer per group.
 *
 * ── THE IDENTITY IS `tripGroupId`, AND NOTHING ELSE ─────────────────────────
 * The membership the schema stores, which is the same one `createGroup`,
 * `removeFromGroup` and the pricing resolver already work in. Nothing is
 * inferred from route, container type, booking number or planning date — two
 * Trips that merely look alike are not a group and share nothing.
 *
 * ── AND THE CONFLICT IS DELIBERATELY NOT RESOLVED ───────────────────────────
 * Two Trips arriving in a group with DIFFERENT numbers is a case this codebase
 * has no rule for. Neither is newer in any sense the schema records and neither
 * leg is privileged, so nothing is copied and both survive. Choosing one would
 * destroy a value somebody typed.
 * ────────────────────────────────────────────────────────────────────────────
 */

const GROUP_ID = "5c2f4d8e-1a3b-4c6d-8e9f-0a1b2c3d4e5f";
const TRIP_A = "11111111-1111-4111-8111-111111111111";
const TRIP_B = "22222222-2222-4222-8222-222222222222";

type Row = Trip;

/** A complete Trip row: the response mapper reads every column. */
function row(id: string, overrides: Partial<Trip> = {}): Trip {
  return {
    id,
    pdfDocumentId: null,
    tripGroupId: null,
    vehicleId: null,
    driverId: null,
    status: TripStatus.OPEN,
    isLooseTrip: false,
    isPaid: false,
    direction: null,
    bookingNumber: "BK-2026-0042",
    containerNumber: null,
    containerType: "45PH",
    terminal: null,
    destinationCity: "Bousbecque",
    destinationCountry: "France",
    originalPlanningDate: new Date("2026-08-17T00:00:00.000Z"),
    planningDate: new Date("2026-08-17T00:00:00.000Z"),
    startTime: null,
    endTime: null,
    executionDatetime: null,
    waitingTimeStart: null,
    waitingTimeEnd: null,
    waitingTimeMinutes: null,
    distanceKm: null,
    tarNummer: null,
    internalNotes: null,
    parserMetadata: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    ...overrides,
  };
}

function buildService(stored: Row[]) {
  const shareTarNummerWithinGroup = jest.fn(
    (groupId: string, tarNummer: string | null, excludeTripId: string) => {
      const followers = stored.filter(
        (trip) =>
          trip.tripGroupId === groupId &&
          trip.id !== excludeTripId &&
          trip.status !== TripStatus.DELETED,
      );

      for (const follower of followers) {
        follower.tarNummer = tarNummer;
      }

      return Promise.resolve(followers.length);
    },
  );

  const repository = {
    findById: jest.fn((id: string) =>
      Promise.resolve(stored.find((trip) => trip.id === id) ?? null),
    ),
    findManyByIds: jest.fn((ids: readonly string[]) =>
      Promise.resolve(stored.filter((trip) => ids.includes(trip.id))),
    ),
    createTripGroup: jest.fn().mockResolvedValue({ id: GROUP_ID }),
    assignToGroup: jest.fn((ids: readonly string[], groupId: string) => {
      for (const trip of stored) {
        if (ids.includes(trip.id)) {
          trip.tripGroupId = groupId;
        }
      }

      return Promise.resolve(ids.length);
    }),
    update: jest.fn((id: string, data: Record<string, unknown>) => {
      const trip = stored.find((candidate) => candidate.id === id) as Row;

      if (data.tarNummer !== undefined) {
        trip.tarNummer = data.tarNummer as string | null;
      }

      return Promise.resolve(trip);
    }),
    shareTarNummerWithinGroup,
    // Assigned below: it hands the work THIS repository, so it cannot be part
    // of the object literal that defines it.
    runInTransaction: jest.fn(),
  };

  /*
   * The transaction is the same repository. What matters for these tests is
   * that the edit and the group write happen inside ONE call, which the double
   * records.
   */
  repository.runInTransaction.mockImplementation(
    (work: (repo: unknown) => Promise<unknown>) => work(repository),
  );

  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  // The Engine is stubbed rather than omitted, so a test can prove it is never
  // called — sharing a TAR-nummer must not reprice anything.
  const recalculation = { recalculate: jest.fn() };

  const service = new TripService(
    repository as unknown as TripRepository,
    {} as never,
    {} as never,
    // Builds the response; these tests are about what was WRITTEN, so it
    // resolves nothing.
    {
      resolveOne: jest.fn().mockResolvedValue({}),
      resolveMany: jest.fn().mockResolvedValue(new Map()),
    } as never,
    { applyToNewTrip: jest.fn(), applyToUpdatedTrip: jest.fn() } as never,
    recalculation as never,
    { publish: jest.fn() } as never,
    logger as unknown as AppLoggerService,
  );

  return {
    service,
    repository,
    logger,
    recalculation,
    shareTarNummerWithinGroup,
  };
}

describe("sharing a TAR-nummer across a group", () => {
  describe("when an operator edits one leg", () => {
    it("copies the value onto the other legs", async () => {
      const stored = [
        row(TRIP_A, { tripGroupId: GROUP_ID }),
        row(TRIP_B, { tripGroupId: GROUP_ID }),
      ];
      const { service } = buildService(stored);

      await service.update(TRIP_A, { tarNummer: "TAR123" });

      expect(stored[0].tarNummer).toBe("TAR123");
      expect(stored[1].tarNummer).toBe("TAR123");
    });

    /** Clearing is a statement too: the group has no TAR-nummer any more. */
    it("clears the other legs when the value is cleared", async () => {
      const stored = [
        row(TRIP_A, { tripGroupId: GROUP_ID, tarNummer: "TAR123" }),
        row(TRIP_B, { tripGroupId: GROUP_ID, tarNummer: "TAR123" }),
      ];
      const { service } = buildService(stored);

      await service.update(TRIP_A, { tarNummer: null });

      expect(stored[1].tarNummer).toBeNull();
    });

    /** One statement for the whole group, however many members it has. */
    it("writes the group in a single query", async () => {
      const stored = [
        row(TRIP_A, { tripGroupId: GROUP_ID }),
        row(TRIP_B, { tripGroupId: GROUP_ID }),
        row("33333333-3333-4333-8333-333333333333", { tripGroupId: GROUP_ID }),
      ];
      const { service, shareTarNummerWithinGroup } = buildService(stored);

      await service.update(TRIP_A, { tarNummer: "TAR123" });

      expect(shareTarNummerWithinGroup).toHaveBeenCalledTimes(1);
    });

    it("does it in the same transaction as the edit", async () => {
      const stored = [
        row(TRIP_A, { tripGroupId: GROUP_ID }),
        row(TRIP_B, { tripGroupId: GROUP_ID }),
      ];
      const { service, repository } = buildService(stored);

      await service.update(TRIP_A, { tarNummer: "TAR123" });

      expect(repository.runInTransaction).toHaveBeenCalledTimes(1);
    });

    /** A standalone Trip has nobody to tell. */
    it("leaves a Trip outside any group alone", async () => {
      const stored = [row(TRIP_A), row(TRIP_B)];
      const { service, shareTarNummerWithinGroup } = buildService(stored);

      await service.update(TRIP_A, { tarNummer: "TAR123" });

      expect(shareTarNummerWithinGroup).not.toHaveBeenCalled();
      expect(stored[1].tarNummer).toBeNull();
    });

    /** Editing something else must not touch the group's TAR-nummer. */
    it("does not share when the edit is about another field", async () => {
      const stored = [
        row(TRIP_A, { tripGroupId: GROUP_ID }),
        row(TRIP_B, { tripGroupId: GROUP_ID, tarNummer: "TAR123" }),
      ];
      const { service, shareTarNummerWithinGroup } = buildService(stored);

      await service.update(TRIP_A, { internalNotes: "call the customer" });

      expect(shareTarNummerWithinGroup).not.toHaveBeenCalled();
      expect(stored[1].tarNummer).toBe("TAR123");
    });
  });

  describe("when a group is formed", () => {
    it("carries the one stated value onto the empty legs", async () => {
      const stored = [row(TRIP_A, { tarNummer: "TAR123" }), row(TRIP_B)];
      const { service } = buildService(stored);

      await service.createGroup([TRIP_A, TRIP_B]);

      expect(stored[0].tarNummer).toBe("TAR123");
      expect(stored[1].tarNummer).toBe("TAR123");
    });

    it("does nothing when both legs are empty", async () => {
      const stored = [row(TRIP_A), row(TRIP_B)];
      const { service, shareTarNummerWithinGroup } = buildService(stored);

      await service.createGroup([TRIP_A, TRIP_B]);

      expect(shareTarNummerWithinGroup).not.toHaveBeenCalled();
      expect(stored.every((trip) => trip.tarNummer === null)).toBe(true);
    });

    it("does nothing when both legs already agree", async () => {
      const stored = [
        row(TRIP_A, { tarNummer: "TAR123" }),
        row(TRIP_B, { tarNummer: "TAR123" }),
      ];
      const { service } = buildService(stored);

      await service.createGroup([TRIP_A, TRIP_B]);

      expect(stored.every((trip) => trip.tarNummer === "TAR123")).toBe(true);
    });

    /**
     * ── THE CONFLICT ──────────────────────────────────────────────────────
     * No rule exists for which value wins, so neither is touched and the
     * grouping proceeds exactly as it always did. Refusing it instead would
     * change how groups are formed, which is not this rule's business.
     */
    describe("when the legs state different numbers", () => {
      const conflicting = () => [
        row(TRIP_A, { tarNummer: "TAR123" }),
        row(TRIP_B, { tarNummer: "TAR456" }),
      ];

      it("overwrites neither", async () => {
        const stored = conflicting();
        const { service } = buildService(stored);

        await service.createGroup([TRIP_A, TRIP_B]);

        expect(stored[0].tarNummer).toBe("TAR123");
        expect(stored[1].tarNummer).toBe("TAR456");
      });

      it("still forms the group", async () => {
        const stored = conflicting();
        const { service } = buildService(stored);

        await service.createGroup([TRIP_A, TRIP_B]);

        expect(stored.every((trip) => trip.tripGroupId === GROUP_ID)).toBe(true);
      });

      it("warns, so somebody can reconcile it", async () => {
        const { service, logger } = buildService(conflicting());

        await service.createGroup([TRIP_A, TRIP_B]);

        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining("different TAR-nummers"),
          expect.objectContaining({ distinctCount: 2 }),
        );
      });

      /** A TAR-nummer is business data and never reaches the log. */
      it("logs the count, never the values", async () => {
        const { service, logger } = buildService(conflicting());

        await service.createGroup([TRIP_A, TRIP_B]);

        expect(JSON.stringify(logger.warn.mock.calls)).not.toMatch(/TAR123|TAR456/);
      });
    });
  });

  /**
   * ── IT PRICES NOTHING ─────────────────────────────────────────────────────
   * Sharing a TAR-nummer is a data rule. It holds no Engine and no snapshot
   * writer, so no historical Trip is recalculated by it — a CLOSED Trip keeps
   * the amounts it was priced with until an explicit reprocess.
   */
  it("never recalculates pricing", async () => {
    const stored = [
      row(TRIP_A, { tripGroupId: GROUP_ID, status: TripStatus.CLOSED }),
      row(TRIP_B, { tripGroupId: GROUP_ID, status: TripStatus.CLOSED }),
    ];
    const { service, recalculation } = buildService(stored);

    await service.update(TRIP_A, { tarNummer: "TAR123" });

    expect(recalculation.recalculate).not.toHaveBeenCalled();
    expect(stored[1].tarNummer).toBe("TAR123");
  });
});
