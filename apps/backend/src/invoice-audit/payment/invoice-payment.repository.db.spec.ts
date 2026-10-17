import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import { PrismaService } from "../../prisma/prisma.service";
import { PaymentSelectionNoLongerEligibleException } from "../exceptions/invoice-audit.exceptions";
import { InvoicePaymentRepository } from "./invoice-payment.repository";

/**
 * The one write of the invoice check — against a REAL database, because "all
 * or nothing" is a property of the transaction and no double can prove it.
 *
 * Opt-in and disposable only: runs when TEST_DATABASE_URL is set and WRITES
 * rows. Every test makes Trips of its own.
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;

describeWithDatabase("settling an invoice's transports against a real database", () => {
  let client: PrismaClient;
  let payments: InvoicePaymentRepository;

  beforeEach(() => {
    client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: DATABASE_URL as string, max: 1 }),
    });
    payments = new InvoicePaymentRepository(client as unknown as PrismaService);
  });

  afterEach(async () => {
    await client.$disconnect();
  });

  const unique = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`;

  async function aTrip(status = "CLOSED", isPaid = false): Promise<string> {
    const [{ id }] = await client.$queryRaw<{ id: string }[]>`
      INSERT INTO trip (booking_number, status, is_paid)
      VALUES (${`BK${unique()}`}, ${status}::"trip_status", ${isPaid})
      RETURNING id`;

    return id;
  }

  /**
   * Read through a client of its own: a connection that saw a transaction fail
   * is not trusted to answer what the transaction left behind.
   */
  async function paidOf(ids: readonly string[]): Promise<boolean[]> {
    const reader = new PrismaClient({
      adapter: new PrismaPg({ connectionString: DATABASE_URL as string, max: 1 }),
    });

    try {
      const trips = await reader.trip.findMany({ where: { id: { in: [...ids] } } });

      return ids.map((id) => trips.find((trip) => trip.id === id)!.isPaid);
    } finally {
      await reader.$disconnect();
    }
  }

  it("pays every chosen CLOSED, unpaid Trip", async () => {
    const ids = [await aTrip(), await aTrip()];

    await expect(payments.settle(ids)).resolves.toBe(2);
    expect(await paidOf(ids)).toEqual([true, true]);
  });

  it("pays none when one was reopened in the meantime", async () => {
    const ids = [await aTrip(), await aTrip("OPEN")];

    await expect(payments.settle(ids)).rejects.toBeInstanceOf(
      PaymentSelectionNoLongerEligibleException,
    );
    expect(await paidOf(ids)).toEqual([false, false]);
  });

  it("pays none when one was paid by somebody else in the meantime", async () => {
    const ids = [await aTrip(), await aTrip("CLOSED", true)];

    await expect(payments.settle(ids)).rejects.toBeInstanceOf(
      PaymentSelectionNoLongerEligibleException,
    );
    expect(await paidOf(ids)).toEqual([false, true]);
  });
});
