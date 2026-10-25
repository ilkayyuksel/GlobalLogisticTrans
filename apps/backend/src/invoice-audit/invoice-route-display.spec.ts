import { Prisma, TripDirection } from "@prisma/client";

import { aTrip, day, invoiceWorld, type InvoiceWorld } from "./__fixtures__/invoice-world";
import type { InvoiceFixtureLine } from "./__fixtures__/invoice-workbook";

/**
 * The route under a line's booking in the preview: the route of the Trip the
 * line is matched to as a TRANSPORT, as the Trip domain derives it — never the
 * Trip an EC line's confirmation belongs to, and nothing without a match.
 */

const TUESDAY = "2026-10-06";

const line = (booking: string, container: string, amounts: Partial<InvoiceFixtureLine> = {}): InvoiceFixtureLine => ({
  planningDate: day(TUESDAY),
  bookingNumber: booking,
  containerNumber: `${container.slice(0, 4)} ${container.slice(4)}`,
  tarief: 200,
  fuel: 30,
  ...amounts,
});

const ecLine = (booking: string, ccNumber: string): InvoiceFixtureLine => ({
  planningDate: day(TUESDAY),
  bookingNumber: booking,
  containerNumber: "",
  tarief: null,
  ek: 110,
  remarks: `EC ${ccNumber}`,
  containerType: null,
  startPoint: null,
  endPoint: null,
});

describe("the route shown under a line's booking", () => {
  let world: InvoiceWorld;

  beforeEach(() => {
    world = invoiceWorld();
    world.trips.push(
      aTrip("zemst", "ANRDUB2810001", "EUCU1000001", TUESDAY, {
        direction: TripDirection.DELIVERY,
        terminal: "Quay 869",
        destinationCity: "ZEMST",
      }),
    );
  });

  it("shows the matched Trip's route when its price is raised", async () => {
    const { result } = await world.check([line("ANRDUB2810001", "EUCU1000001", { tarief: 150 })]);

    expect(result.rows[0]).toMatchObject({ pricingStatus: "PRICING_CORRECTED", route: "Quay 869 → ZEMST" });
  });

  it("shows it when the prices are unchanged", async () => {
    const { result } = await world.check([line("ANRDUB2810001", "EUCU1000001")]);

    expect(result.rows[0]).toMatchObject({ pricingStatus: "MATCHED_NO_CHANGES", route: "Quay 869 → ZEMST" });
  });

  it("shows it for a price that cannot be relied on, the match being valid", async () => {
    world.unreliable.add("zemst");

    const { result } = await world.check([line("ANRDUB2810001", "EUCU1000001")]);

    expect(result.rows[0]).toMatchObject({ pricingStatus: "PRICE_UNRELIABLE", route: "Quay 869 → ZEMST" });
  });

  it("follows the leg's own direction: a collection runs from its city to the terminal", async () => {
    world.trips.push(
      aTrip("leg", "DUBANR2810002", "EUCU1000002", TUESDAY, {
        direction: TripDirection.COLLECTION,
        terminal: "Quay 869",
        destinationCity: "GENT",
      }),
    );

    const { result } = await world.check([line("DUBANR2810002", "EUCU1000002")]);

    expect(result.rows[0].route).toBe("GENT → Quay 869");
  });

  describe("on an EC line: the transport match's route, never the confirmation's", () => {
    beforeEach(() => {
      // The confirmation belongs to another Trip, to Mechelen.
      world.trips.push(
        aTrip("mechelen", "ANRDUB2810001", "EUCU1000009", "2026-10-05", {
          direction: TripDirection.DELIVERY,
          terminal: "Quay 869",
          destinationCity: "MECHELEN",
        }),
      );
      world.confirmations.push({ tripId: "mechelen", ccNumber: "4220981", amount: new Prisma.Decimal(110) });
    });

    it("an EC line that is its transport's line shows that transport's route", async () => {
      const { result } = await world.check([ecLine("ANRDUB2810001", "4220981")]);

      expect(result.rows[0]).toMatchObject({ status: "MATCHED", trip: { id: "zemst" }, route: "Quay 869 → ZEMST" });
    });

    it("an EC charge beside its transport's line shows the route its own values identify", async () => {
      world.confirmations.push({ tripId: "zemst", ccNumber: "4220982", amount: new Prisma.Decimal(110) });

      const { result } = await world.check([line("ANRDUB2810001", "EUCU1000001"), ecLine("ANRDUB2810001", "4220982")]);

      expect(result.rows[1]).toMatchObject({ status: "COST_LINE", route: "Quay 869 → ZEMST" });
    });
  });

  it("shows no route without a transport match", async () => {
    const { result } = await world.check([line("ANRDUB2819999", "EUCU9999999")]);

    expect(result.rows[0]).toMatchObject({ status: "NOT_FOUND", route: null });
  });

  it("shows no route for a line that could be several Trips", async () => {
    world.trips.push(aTrip("twin", "ANRDUB2810001", "EUCU1000003", TUESDAY));

    const { result } = await world.check([line("ANRDUB2810001", "EUCU9999999")]);

    expect(result.rows[0]).toMatchObject({ status: "AMBIGUOUS", route: null });
  });
});
