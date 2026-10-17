import { Prisma, Trip, TripStatus } from "@prisma/client";

import { AppLoggerService } from "../../logger/app-logger.service";
import { TripRepository } from "../../trips/trip.repository";
import { asReads, invoiceReads, type InvoiceReadsDouble } from "../__fixtures__/invoice-reads";
import { sheetRow, tripRecord } from "../__fixtures__/invoice-rows";
import { InvoiceRowMatchingService } from "./invoice-row-matching.service";

/**
 * Which Trip a line is — the corrections, the Cost Confirmation lines and the
 * Combinations the Excel marks. Rows and Trips are week 41's own values.
 */
describe("identifying invoice lines", () => {
  let trips: { findManyForInvoice: jest.Mock };
  let reads: InvoiceReadsDouble;
  let service: InvoiceRowMatchingService;

  beforeEach(() => {
    trips = { findManyForInvoice: jest.fn().mockResolvedValue([]) };
    reads = invoiceReads();
    service = new InvoiceRowMatchingService(
      trips as unknown as TripRepository,
      asReads(reads),
      { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() } as unknown as AppLoggerService,
    );
  });

  describe("a misprinted booking number", () => {
    it("is corrected to the one Trip holding the container on that day", async () => {
      reads.findTripsOnDates.mockResolvedValue([tripRecord()]);

      const [match] = await service.match([sheetRow({ bookingNumber: "ANRDUB2810000" })]);

      expect(match).toMatchObject({
        status: "MATCHED",
        trip: { id: "trip-1" },
        bookingCorrection: {
          invoiceBookingNumber: "ANRDUB2810000",
          tripBookingNumber: "ANRDUB2810849",
        },
        containerCorrection: null,
      });
    });

    it("is only looked for when no Trip holds the booking on that day", async () => {
      trips.findManyForInvoice.mockResolvedValue([tripRecord()]);

      await service.match([sheetRow()]);

      expect(reads.findTripsOnDates).not.toHaveBeenCalled();
    });

    /** Week 41 R75–R76: one container, two legs, one day. */
    it("is not corrected when two Trips hold the container that day", async () => {
      reads.findTripsOnDates.mockResolvedValue([
        tripRecord({ id: "leg-1", bookingNumber: "DUBANR2801548", containerNumber: "PVDU1112788" }),
        tripRecord({ id: "leg-2", bookingNumber: "ANRDUB2815064", containerNumber: "PVDU1112788" }),
      ]);

      const [match] = await service.match([
        sheetRow({ bookingNumber: "ANRDUB2815000", containerNumber: "PVDU 1112788" }),
      ]);

      expect(match).toMatchObject({ status: "AMBIGUOUS", trip: null, bookingCorrection: null });
      expect(match.candidates.map((trip) => trip.id)).toEqual(["leg-1", "leg-2"]);
    });

    it("is not corrected towards an unfinished Trip", async () => {
      reads.findTripsOnDates.mockResolvedValue([tripRecord({ status: TripStatus.OPEN })]);

      const [match] = await service.match([sheetRow({ bookingNumber: "ANRDUB2810000" })]);

      expect(match).toMatchObject({ status: "NOT_FINISHED", bookingCorrection: null });
    });

    it("is not corrected on another day", async () => {
      reads.findTripsOnDates.mockResolvedValue([
        tripRecord({
          planningDate: new Date("2026-10-06T00:00:00.000Z"),
          originalPlanningDate: new Date("2026-10-06T00:00:00.000Z"),
        }),
      ]);

      const [match] = await service.match([sheetRow({ bookingNumber: "ANRDUB2810000" })]);

      expect(match.status).toBe("NOT_FOUND");
    });

    it("is never corrected together with the container", async () => {
      reads.findTripsOnDates.mockResolvedValue([tripRecord()]);

      const [match] = await service.match([
        sheetRow({ bookingNumber: "ANRDUB2810000", containerNumber: "EUCU 9999999" }),
      ]);

      expect(match.status).toBe("NOT_FOUND");
    });
  });

  describe("a correction towards a Trip another line already is", () => {
    it("is withdrawn, and the line is a conflict", async () => {
      // R5 names the Trip exactly; R9 would reach it only by its booking.
      trips.findManyForInvoice.mockResolvedValue([tripRecord()]);
      reads.findTripsOnDates.mockResolvedValue([tripRecord()]);

      const matches = await service.match([
        sheetRow({ rowNumber: 5 }),
        sheetRow({ rowNumber: 9, bookingNumber: "ANRDUB2810000" }),
      ]);

      expect(matches[0]).toMatchObject({ status: "MATCHED", trip: { id: "trip-1" } });
      expect(matches[1]).toMatchObject({
        status: "CONFLICT",
        trip: null,
        bookingCorrection: null,
        problem: expect.stringContaining("rij 5"),
      });
    });

    it("never conflicts with the rows of one transport split over several lines", async () => {
      trips.findManyForInvoice.mockResolvedValue([tripRecord()]);

      const matches = await service.match([sheetRow({ rowNumber: 5 }), sheetRow({ rowNumber: 6 })]);

      expect(matches.map((match) => match.status)).toEqual(["MATCHED", "MATCHED"]);
    });
  });

  describe("a Cost Confirmation line", () => {
    /** Week 41 R53: no container, one EC, an EK. */
    const r53 = sheetRow({
      rowNumber: 53,
      planningDate: "2026-10-06",
      bookingNumber: "ANRDUB2812770",
      containerNumber: "",
      normalizedContainerNumber: "",
      startPoint: "",
      endPoint: "",
      remarks: "EC 4220981",
      costLine: { ccNumbers: ["4220981"] },
    });
    const bousbecque = tripRecord({
      id: "trip-bousbecque",
      bookingNumber: "ANRDUB2812770",
      containerNumber: "TLLU1609235",
    });

    function confirm(...tripIds: string[]) {
      reads.findCostConfirmationsByNumbers.mockResolvedValue(
        tripIds.map((tripId) => ({ tripId, ccNumber: "4220981", amount: new Prisma.Decimal("110") })),
      );
    }

    it("is resolved through the confirmation it names", async () => {
      confirm("trip-bousbecque");
      reads.findTripsByIds.mockResolvedValue([bousbecque]);

      const [match] = await service.match([r53]);

      expect(match).toMatchObject({
        status: "COST_LINE",
        trip: { id: "trip-bousbecque" },
        costConfirmation: { ccNumber: "4220981" },
      });
      expect(reads.findCostConfirmationsByNumbers).toHaveBeenCalledWith(["4220981"]);
      // Never through the transport lines' own query.
      expect(trips.findManyForInvoice).not.toHaveBeenCalledWith(
        expect.objectContaining({ bookingNumbers: ["ANRDUB2812770"] }),
      );
    });

    it.each([
      ["an unknown confirmation", [] as string[], [] as Trip[], /^Geen kostenbevestiging gevonden voor EC 4220981\.$/],
      ["a confirmation of several Trips", ["a", "b"], [], /meerdere ritten/],
    ])("is unresolved for %s", async (_label, tripIds, found, problem) => {
      confirm(...tripIds);
      reads.findTripsByIds.mockResolvedValue(found);

      const [match] = await service.match([r53]);

      expect(match).toMatchObject({ status: "COST_LINE_UNRESOLVED", trip: null });
      expect(match.problem).toMatch(problem);
    });

    it("is unresolved when the confirmation's Trip has another booking", async () => {
      confirm("trip-bousbecque");
      reads.findTripsByIds.mockResolvedValue([{ ...bousbecque, bookingNumber: "ANRDUB0000000" }]);

      const [match] = await service.match([r53]);

      expect(match.status).toBe("COST_LINE_UNRESOLVED");
      expect(match.candidates.map((trip) => trip.id)).toEqual(["trip-bousbecque"]);
    });

    it("is unresolved when it states another container than the Trip's", async () => {
      confirm("trip-bousbecque");
      reads.findTripsByIds.mockResolvedValue([bousbecque]);

      const [match] = await service.match([
        { ...r53, containerNumber: "EUCU 4580552", normalizedContainerNumber: "EUCU4580552" },
      ]);

      expect(match.status).toBe("COST_LINE_UNRESOLVED");
    });

    it("is unresolved when its Trip is not finished", async () => {
      confirm("trip-bousbecque");
      reads.findTripsByIds.mockResolvedValue([{ ...bousbecque, status: TripStatus.OPEN }]);

      const [match] = await service.match([r53]);

      expect(match.status).toBe("COST_LINE_UNRESOLVED");
    });

    it("is unresolved when it names more than one confirmation", async () => {
      const [match] = await service.match([
        { ...r53, costLine: { ccNumbers: ["4220981", "4220982"] } },
      ]);

      expect(match.status).toBe("COST_LINE_UNRESOLVED");
      expect(reads.findTripsByIds).toHaveBeenCalled();
    });
  });

  describe("a Combination the Excel marks", () => {
    /** Week 41 R3–R4: out to Lessines on the 5th, back from Harnes on the 6th. */
    const r3 = sheetRow({
      rowNumber: 3,
      bookingNumber: "DUBANR2803000",
      containerNumber: "EUCU 4580491",
      startPoint: "VOYAGE BEQ869",
      endPoint: "COMBINATION ",
    });
    const r4 = sheetRow({
      rowNumber: 4,
      planningDate: "2026-10-06",
      bookingNumber: "ANRBEL2814875",
      containerNumber: "EUCU 4580491",
      startPoint: "COMBINATION ",
      endPoint: "VOYAGE BEQ869",
    });
    const leg = (id: string, booking: string, day: string, tripGroupId: string | null) =>
      tripRecord({
        id,
        bookingNumber: booking,
        containerNumber: "EUCU4580491",
        planningDate: new Date(`${day}T00:00:00.000Z`),
        originalPlanningDate: new Date(`${day}T00:00:00.000Z`),
        tripGroupId,
      });

    it("is recognised when the system groups exactly these two Trips", async () => {
      trips.findManyForInvoice.mockResolvedValue([
        leg("leg-1", "DUBANR2803000", "2026-10-05", "group-1"),
        leg("leg-2", "ANRBEL2814875", "2026-10-06", "group-1"),
      ]);
      reads.countGroupMembers.mockResolvedValue(new Map([["group-1", 2]]));

      const matches = await service.match([r3, r4]);

      expect(matches.map((match) => match.combination)).toEqual([
        { verdict: "RECOGNISED", partnerRowNumber: 4, reason: null },
        { verdict: "RECOGNISED", partnerRowNumber: 3, reason: null },
      ]);
    });

    it("is GEEN COMBI when neither Trip belongs to a group", async () => {
      trips.findManyForInvoice.mockResolvedValue([
        leg("leg-1", "DUBANR2803000", "2026-10-05", null),
        leg("leg-2", "ANRBEL2814875", "2026-10-06", null),
      ]);

      const matches = await service.match([r3, r4]);

      expect(matches.map((match) => match.combination?.verdict)).toEqual(["GEEN_COMBI", "GEEN_COMBI"]);
    });

    it("is under review when one row of the pair matches nothing", async () => {
      trips.findManyForInvoice.mockResolvedValue([leg("leg-1", "DUBANR2803000", "2026-10-05", null)]);

      const matches = await service.match([r3, r4]);

      expect(matches.map((match) => match.combination?.verdict)).toEqual(["REVIEW", "REVIEW"]);
    });
  });
});
