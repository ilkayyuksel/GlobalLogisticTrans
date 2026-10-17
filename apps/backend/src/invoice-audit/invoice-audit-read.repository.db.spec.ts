import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { InvoiceAuditReadRepository } from "./invoice-audit-read.repository";

/**
 * The invoice check's own reads — against a REAL database.
 *
 * Opt-in and disposable only: runs when TEST_DATABASE_URL is set and WRITES
 * rows. See `cost-confirmation.concurrency.db.spec.ts`. Every test uses its own
 * day, bookings and confirmation numbers, so tests never see each other's rows.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;

describeWithDatabase("the invoice check's reads against a real database", () => {
  let client: PrismaClient;
  let reads: InvoiceAuditReadRepository;

  beforeEach(() => {
    client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: DATABASE_URL as string, max: 1 }),
    });
    reads = new InvoiceAuditReadRepository(client as unknown as PrismaService);
  });

  afterEach(async () => {
    await client.$disconnect();
  });

  const unique = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

  /** A day of its own, far from any other test's. */
  function aDay(): Date {
    return new Date(Date.UTC(2031, 0, 1 + Math.floor(Math.random() * 3000)));
  }

  async function aTrip(fields: {
    status?: string;
    planningDate?: Date | null;
    originalPlanningDate?: Date | null;
    tripGroupId?: string | null;
  } = {}): Promise<string> {
    const [{ id }] = await client.$queryRaw<{ id: string }[]>`
      INSERT INTO trip (booking_number, status, planning_date, original_planning_date, trip_group_id)
      VALUES (
        ${`BK${unique()}`},
        ${fields.status ?? "CLOSED"}::"trip_status",
        ${fields.planningDate ?? null}::date,
        ${fields.originalPlanningDate ?? null}::date,
        ${fields.tripGroupId ?? null}::uuid
      )
      RETURNING id`;

    return id;
  }

  async function aGroup(): Promise<string> {
    const [{ id }] = await client.$queryRaw<{ id: string }[]>`
      INSERT INTO trip_group DEFAULT VALUES RETURNING id`;

    return id;
  }

  async function aConfirmation(tripId: string, ccNumber: string, amount: string): Promise<void> {
    const [{ id: pdfDocumentId }] = await client.$queryRaw<{ id: string }[]>`
      INSERT INTO pdf_document (import_source, original_filename, storage_path, file_size_bytes, file_hash, mime_type)
      VALUES ('MANUAL_UPLOAD', 'cc.pdf', ${`test/${unique()}`}, 1, 'hash', 'application/pdf')
      RETURNING id`;

    await client.costConfirmation.create({
      data: { tripId, pdfDocumentId, ccNumber, costCode: "WAIT", amount, receivedAt: new Date() },
    });
  }

  describe("findTripsOnDates", () => {
    it("finds a Trip by either of its dates, and never a deleted one", async () => {
      const day = aDay();
      const planned = await aTrip({ planningDate: day });
      const ordered = await aTrip({ originalPlanningDate: day, planningDate: aDay() });
      await aTrip({ planningDate: day, status: "DELETED" });
      await aTrip({ planningDate: aDay() });

      const found = await reads.findTripsOnDates([day]);

      expect(found.map((trip) => trip.id).sort()).toEqual([planned, ordered].sort());
    });
  });

  describe("findCostConfirmationsByNumbers", () => {
    it("answers each confirmation with its Trip and amount", async () => {
      const tripId = await aTrip();
      const number = unique();
      await aConfirmation(tripId, number, "110.00");

      expect(await reads.findCostConfirmationsByNumbers([number])).toEqual([
        { tripId, ccNumber: number, amount: expect.anything() },
      ]);
      expect((await reads.findCostConfirmationsByNumbers([number]))[0].amount.toFixed(2)).toBe("110.00");
    });

    /** A number is unique per Trip, not across Trips: both are answered. */
    it("answers every Trip a number belongs to, but not a deleted one", async () => {
      const number = unique();
      const first = await aTrip();
      const second = await aTrip();
      const deleted = await aTrip({ status: "DELETED" });
      await aConfirmation(first, number, "70.00");
      await aConfirmation(second, number, "70.00");
      await aConfirmation(deleted, number, "70.00");

      const found = await reads.findCostConfirmationsByNumbers([number]);

      expect(found.map((confirmation) => confirmation.tripId).sort()).toEqual([first, second].sort());
    });
  });

  describe("findTripsByIds", () => {
    it("leaves a deleted Trip out", async () => {
      const kept = await aTrip();
      const deleted = await aTrip({ status: "DELETED" });

      expect((await reads.findTripsByIds([kept, deleted])).map((trip) => trip.id)).toEqual([kept]);
    });
  });

  describe("countGroupMembers", () => {
    it("counts each group's Trips, deleted ones left out", async () => {
      const pair = await aGroup();
      const three = await aGroup();
      await aTrip({ tripGroupId: pair });
      await aTrip({ tripGroupId: pair });
      await aTrip({ tripGroupId: pair, status: "DELETED" });
      await aTrip({ tripGroupId: three });
      await aTrip({ tripGroupId: three, status: "OPEN" });
      await aTrip({ tripGroupId: three, status: "CANCELLED" });

      const counts = await reads.countGroupMembers([pair, three]);

      expect(counts.get(pair)).toBe(2);
      expect(counts.get(three)).toBe(3);
    });
  });
});
