import { CostConfirmation, Prisma } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { stubPricingRecalculation } from "../pricing-engine/pricing-recalculation.double";
import {
  CostConfirmationRepository,
  violatesConfirmationIdentity,
} from "./cost-confirmation.repository";
import { CostConfirmationService } from "./cost-confirmation.service";

/**
 * The insert that loses a race to the same confirmation.
 *
 * `cost-confirmation.concurrency.db.spec.ts` runs the real race against a real
 * database, but only when one is provided. These run everywhere and pin the
 * decision itself: which refusals are a duplicate confirmation, and which are
 * failures that must stay visible.
 */

const TRIP_ID = "trip-1";
const CC_NUMBER = "4132482";

/** P2002 as Prisma raises it through the `pg` driver adapter. */
function adapterUniqueViolation(fields: string[]) {
  return new Prisma.PrismaClientKnownRequestError(
    `Unique constraint failed on the fields: (${fields.map((field) => `\`${field}\``).join(", ")})`,
    {
      code: "P2002",
      clientVersion: "7.9.1",
      meta: {
        modelName: "CostConfirmation",
        driverAdapterError: {
          name: "DriverAdapterError",
          cause: { kind: "UniqueConstraintViolation", constraint: { fields } },
        },
      },
    },
  );
}

/** P2002 as the classic query engine raises it. */
function engineUniqueViolation(target: string[]) {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "7.9.1",
    meta: { modelName: "CostConfirmation", target },
  });
}

function storedRow(): CostConfirmation {
  return {
    id: "cc-winner",
    tripId: TRIP_ID,
    pdfDocumentId: "pdf-1",
    ccNumber: CC_NUMBER,
    costCode: "WAIT",
    amount: new Prisma.Decimal("25.00"),
    currency: "EUR",
    receivedAt: new Date("2026-08-18T09:00:00.000Z"),
    createdAt: new Date("2026-08-18T09:00:00.000Z"),
    updatedAt: new Date("2026-08-18T09:00:00.000Z"),
  };
}

const COMMAND = {
  tripId: TRIP_ID,
  pdfDocumentId: "pdf-2",
  ccNumber: CC_NUMBER,
  costCode: "WAIT",
  amount: "25.00",
  currency: "EUR",
  receivedAt: new Date("2026-08-18T09:00:00.000Z"),
};

describe("violatesConfirmationIdentity", () => {
  it("recognises the identity constraint as the pg adapter reports it", () => {
    expect(
      violatesConfirmationIdentity(adapterUniqueViolation(["trip_id", "cc_number"])),
    ).toBe(true);
  });

  it("recognises it as the classic engine reports it", () => {
    expect(
      violatesConfirmationIdentity(engineUniqueViolation(["trip_id", "cc_number"])),
    ).toBe(true);
  });

  it.each([
    ["the primary key", ["id"]],
    ["one column of it", ["trip_id"]],
    ["a wider constraint", ["trip_id", "cc_number", "pdf_document_id"]],
  ])("does not take a conflict on %s for a duplicate", (_label, fields) => {
    expect(violatesConfirmationIdentity(adapterUniqueViolation(fields))).toBe(false);
  });

  it("does not guess when the columns are not reported", () => {
    const unnamed = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "7.9.1",
      meta: { modelName: "CostConfirmation" },
    });

    expect(violatesConfirmationIdentity(unnamed)).toBe(false);
  });

  it("ignores every other error", () => {
    const foreignKey = new Prisma.PrismaClientKnownRequestError("FK", {
      code: "P2003",
      clientVersion: "7.9.1",
      meta: {},
    });

    expect(violatesConfirmationIdentity(foreignKey)).toBe(false);
    expect(violatesConfirmationIdentity(new Error("connection reset"))).toBe(false);
  });
});

describe("CostConfirmationService, when the insert is refused", () => {
  let repository: { create: jest.Mock; findAllByTrip: jest.Mock };
  let recalculation: ReturnType<typeof stubPricingRecalculation>;
  let logger: { setContext: jest.Mock; log: jest.Mock; warn: jest.Mock; error: jest.Mock };
  let service: CostConfirmationService;

  beforeEach(() => {
    repository = { create: jest.fn(), findAllByTrip: jest.fn() };
    recalculation = stubPricingRecalculation();
    logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    service = new CostConfirmationService(
      repository as unknown as CostConfirmationRepository,
      recalculation,
      logger as unknown as AppLoggerService,
    );
  });

  /** The check found nothing; the winner exists by the time it is re-read. */
  function lostTheRace(): void {
    repository.findAllByTrip
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([storedRow()]);
    repository.create.mockRejectedValue(adapterUniqueViolation(["trip_id", "cc_number"]));
  }

  it("answers ALREADY_RECORDED with the row the other import wrote", async () => {
    lostTheRace();

    const result = await service.record(COMMAND);

    expect(result).toEqual({
      outcome: "ALREADY_RECORDED",
      confirmation: storedRow(),
      pricing: null,
      reasonCode: null,
    });
  });

  it("does not reprice: the import that wrote already did", async () => {
    lostTheRace();

    await service.record(COMMAND);

    expect(recalculation.recalculate).not.toHaveBeenCalled();
  });

  it("logs the race so it can be traced", async () => {
    lostTheRace();

    await service.record(COMMAND);

    expect(logger.warn).toHaveBeenCalledWith(
      "Cost confirmation recorded concurrently by another import",
      { tripId: TRIP_ID, ccNumber: CC_NUMBER, recordedConfirmationId: "cc-winner" },
    );
  });

  /*
   * The constraint says a row exists; if it cannot be found for this Trip and
   * number, something else is wrong, and "already recorded" would be a lie.
   */
  it("rethrows when the row it collided with cannot be found", async () => {
    const conflict = adapterUniqueViolation(["trip_id", "cc_number"]);
    repository.findAllByTrip.mockResolvedValue([]);
    repository.create.mockRejectedValue(conflict);

    await expect(service.record(COMMAND)).rejects.toBe(conflict);
    expect(logger.error).toHaveBeenCalled();
  });

  it("7. rethrows a unique conflict on any other constraint", async () => {
    const other = adapterUniqueViolation(["id"]);
    repository.findAllByTrip.mockResolvedValue([]);
    repository.create.mockRejectedValue(other);

    await expect(service.record(COMMAND)).rejects.toBe(other);
    // Not even looked up again: it is not a duplicate question at all.
    expect(repository.findAllByTrip).toHaveBeenCalledTimes(1);
  });

  it("8. rethrows an ordinary database failure", async () => {
    const failure = new Error("connection terminated unexpectedly");
    repository.findAllByTrip.mockResolvedValue([]);
    repository.create.mockRejectedValue(failure);

    await expect(service.record(COMMAND)).rejects.toBe(failure);
    expect(recalculation.recalculate).not.toHaveBeenCalled();
  });
});
