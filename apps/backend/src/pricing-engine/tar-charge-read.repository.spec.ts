import { TripStatus } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { TarChargeReadRepository } from "./tar-charge-read.repository";

const TRIP_ID = "11111111-1111-4111-8111-111111111111";
const TAR_ID = "b36469b0-37ec-40ba-81da-9bc272e05d60";
const DAY = new Date("2026-09-07T00:00:00.000Z");

/**
 * The query that decides whether a TAR-nummer has already been charged today.
 *
 * A wrong `where` here silently charges twice or silently charges nothing, and
 * neither shows up as an error — so the query SHAPE is the assertion, the same
 * way it is for every other repository in this codebase.
 */
describe("TarChargeReadRepository", () => {
  let prisma: { tripPricingItem: { findFirst: jest.Mock } };
  let repository: TarChargeReadRepository;

  beforeEach(() => {
    prisma = { tripPricingItem: { findFirst: jest.fn().mockResolvedValue(null) } };

    repository = new TarChargeReadRepository(
      prisma as unknown as PrismaService,
    );
  });

  function ask() {
    return repository.hasBeenChargedToday({
      tripId: TRIP_ID,
      planningDate: DAY,
      tarNummer: "TAR123",
      automaticCustomPropertyId: TAR_ID,
    });
  }

  /** The whole rule, in one `where`. */
  it("looks for a CHARGE, on another Trip, that day, with that number", async () => {
    await ask();

    expect(prisma.tripPricingItem.findFirst).toHaveBeenCalledWith({
      where: {
        customPropertyId: TAR_ID,
        tripPricing: {
          trip: {
            id: { not: TRIP_ID },
            planningDate: DAY,
            tarNummer: { equals: "TAR123", mode: "insensitive" },
            status: { notIn: [TripStatus.DELETED, TripStatus.CANCELLED] },
          },
        },
      },
      select: { id: true },
    });
  });

  /**
   * The distinction the whole rule rests on: the evidence is a pricing ITEM,
   * not a Trip row carrying the same string. A number typed on a Trip nobody
   * closed produces no item, so it cannot block a real charge.
   */
  it("reads pricing items, never Trips", async () => {
    await ask();

    expect(prisma).not.toHaveProperty("trip");
    expect(prisma.tripPricingItem.findFirst).toHaveBeenCalledTimes(1);
  });

  /** An existence check: no rows are loaded and nothing is counted. */
  it("selects nothing but the key", async () => {
    await ask();

    const [{ select }] = prisma.tripPricingItem.findFirst.mock.calls[0];

    expect(select).toEqual({ id: true });
  });

  it("answers true when such a charge exists", async () => {
    prisma.tripPricingItem.findFirst.mockResolvedValue({ id: "item-1" });

    expect(await ask()).toBe(true);
  });

  it("answers false when none does", async () => {
    prisma.tripPricingItem.findFirst.mockResolvedValue(null);

    expect(await ask()).toBe(false);
  });

  describe("which Trips are disregarded", () => {
    function statusFilter() {
      const [{ where }] = prisma.tripPricingItem.findFirst.mock.calls[0];

      return where.tripPricing.trip.status.notIn;
    }

    /**
     * Soft delete is the model's remedy for a Trip "created incorrectly or is a
     * duplicate". A record nobody should be billed for must not stop somebody
     * else being billed.
     */
    it("disregards a DELETED Trip's charge", async () => {
      await ask();

      expect(statusFilter()).toContain(TripStatus.DELETED);
    });

    /**
     * CANCELLED is "a business cancellation of the underlying transport": a
     * transport that was called off did not incur the charge.
     */
    it("disregards a CANCELLED Trip's charge", async () => {
      await ask();

      expect(statusFilter()).toContain(TripStatus.CANCELLED);
    });

    /**
     * OPEN is deliberately NOT disregarded. A Trip that was closed, charged and
     * then reopened still holds a real charge, and ignoring it would let a
     * second Trip take the same TAR while the first still has it — a double
     * charge produced by reopening.
     */
    it("still counts a reopened Trip's charge", async () => {
      await ask();

      expect(statusFilter()).not.toContain(TripStatus.OPEN);
      expect(statusFilter()).not.toContain(TripStatus.CLOSED);
    });
  });

  /** One number, however it was typed. */
  it("compares the number case-insensitively", async () => {
    await ask();

    const [{ where }] = prisma.tripPricingItem.findFirst.mock.calls[0];

    expect(where.tripPricing.trip.tarNummer.mode).toBe("insensitive");
  });

  /** Read-only by construction: the Engine must not be able to write here. */
  it("offers no way to write", () => {
    expect(repository).not.toHaveProperty("create");
    expect(repository).not.toHaveProperty("update");
    expect(repository).not.toHaveProperty("delete");
  });
});
