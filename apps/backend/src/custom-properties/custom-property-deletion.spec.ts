import { CustomProperty } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { CustomPropertyRepository } from "./custom-property.repository";
import { CustomPropertyService } from "./custom-property.service";
import {
  CustomPropertyHasPricingHistoryException,
  CustomPropertyInUseException,
  CustomPropertyNotFoundException,
  SystemManagedCustomPropertyDeletionException,
} from "./exceptions/custom-property.exceptions";

/**
 * Deleting a Custom Property for real.
 *
 * ── WHAT THIS GUARDS ────────────────────────────────────────────────────────
 * The row physically leaves the database, which is a genuinely destructive
 * thing to put behind a button. Exactly two foreign keys point at
 * `custom_property` and both are ON DELETE RESTRICT, so these tests pin the two
 * dependency refusals, the system-managed refusal that the SCHEMA cannot
 * express, and the fact that nothing is cleaned up on the way out.
 *
 * The one thing deliberately NOT asserted here is that the row is gone from
 * Postgres — a mocked repository cannot show that, and this project has no
 * database-backed test layer to build one on. What it CAN pin is that the
 * service calls `repository.delete` and never `setActive`, so a soft delete
 * cannot be substituted without failing here.
 * ────────────────────────────────────────────────────────────────────────────
 */

const PROPERTY_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const COMPONENT_ID = "8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

function buildProperty(overrides: Partial<CustomProperty> = {}): CustomProperty {
  return {
    id: PROPERTY_ID,
    name: "Aan/Afkoppelen",
    description: null,
    pricingComponentId: null,
    defaultPrice: null,
    displayOrder: 3,
    color: null,
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  } as CustomProperty;
}

describe("deleting a custom property", () => {
  let repository: {
    findById: jest.Mock;
    countAssignments: jest.Mock;
    countPricingItems: jest.Mock;
    delete: jest.Mock;
    runInTransaction: jest.Mock;
  };
  let service: CustomPropertyService;

  beforeEach(() => {
    repository = {
      findById: jest.fn().mockResolvedValue(buildProperty()),
      countAssignments: jest.fn().mockResolvedValue(0),
      countPricingItems: jest.fn().mockResolvedValue(0),
      delete: jest.fn().mockResolvedValue(buildProperty()),
      // The real one hands the service a transaction-scoped clone; this hands
      // back the same double, which is what keeps the call counts meaningful.
      runInTransaction: jest.fn((work) => work(repository)),
    };

    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    service = new CustomPropertyService(
      repository as unknown as CustomPropertyRepository,
      logger as unknown as AppLoggerService,
    );
  });

  describe("an ordinary, unused property", () => {
    it("is physically deleted", async () => {
      await service.remove(PROPERTY_ID);

      expect(repository.delete).toHaveBeenCalledWith(PROPERTY_ID);
    });

    it("is never merely deactivated instead", async () => {
      await service.remove(PROPERTY_ID);

      expect(
        (repository as unknown as { setActive?: jest.Mock }).setActive,
      ).toBeUndefined();
    });

    it("answers with the property that left, by name", async () => {
      const deleted = await service.remove(PROPERTY_ID);

      expect(deleted.id).toBe(PROPERTY_ID);
      expect(deleted.name).toBe("Aan/Afkoppelen");
    });

    /** One transaction, so a race cannot slip an assignment past the count. */
    it("checks and deletes inside one transaction", async () => {
      await service.remove(PROPERTY_ID);

      expect(repository.runInTransaction).toHaveBeenCalledTimes(1);
    });

    /** An inactive property is deletable too: deactivation is not a tombstone. */
    it("deletes a deactivated property just the same", async () => {
      repository.findById.mockResolvedValue(buildProperty({ isActive: false }));

      await service.remove(PROPERTY_ID);

      expect(repository.delete).toHaveBeenCalledWith(PROPERTY_ID);
    });
  });

  describe("a property Trips still carry", () => {
    beforeEach(() => {
      repository.countAssignments.mockResolvedValue(3);
    });

    it("is refused, naming how many Trips hold it", async () => {
      await expect(service.remove(PROPERTY_ID)).rejects.toBeInstanceOf(
        CustomPropertyInUseException,
      );

      await expect(service.remove(PROPERTY_ID)).rejects.toThrow(
        /still assigned to 3 Trips/,
      );
    });

    it("deletes nothing at all", async () => {
      await expect(service.remove(PROPERTY_ID)).rejects.toThrow();

      expect(repository.delete).not.toHaveBeenCalled();
    });

    /** Withdrawing real assignments would change what those Trips are worth. */
    it("withdraws no assignment on the way", async () => {
      await expect(service.remove(PROPERTY_ID)).rejects.toThrow();

      expect(
        (repository as unknown as { deleteAssignments?: jest.Mock })
          .deleteAssignments,
      ).toBeUndefined();
    });

    it("says Trip in the singular for exactly one", async () => {
      repository.countAssignments.mockResolvedValue(1);

      await expect(service.remove(PROPERTY_ID)).rejects.toThrow(
        /still assigned to 1 Trip\./,
      );
    });
  });

  describe("a property named by frozen pricing history", () => {
    beforeEach(() => {
      repository.countPricingItems.mockResolvedValue(2);
    });

    it("is refused, naming how many lines hold it", async () => {
      await expect(service.remove(PROPERTY_ID)).rejects.toBeInstanceOf(
        CustomPropertyHasPricingHistoryException,
      );

      await expect(service.remove(PROPERTY_ID)).rejects.toThrow(
        /appears in 2 frozen pricing lines/,
      );
    });

    /**
     * The whole point of the refusal: a CLOSED Trip's breakdown must keep
     * saying what it said. Nothing here touches trip_pricing_item.
     */
    it("leaves the historical pricing untouched", async () => {
      await expect(service.remove(PROPERTY_ID)).rejects.toThrow();

      expect(repository.delete).not.toHaveBeenCalled();
      expect(
        (repository as unknown as { deletePricingItems?: jest.Mock })
          .deletePricingItems,
      ).toBeUndefined();
    });

    /** Assignments are reported first: they are the one an operator can fix. */
    it("reports the assignments first when both apply", async () => {
      repository.countAssignments.mockResolvedValue(1);

      await expect(service.remove(PROPERTY_ID)).rejects.toBeInstanceOf(
        CustomPropertyInUseException,
      );
    });
  });

  /**
   * The refusals the SCHEMA cannot express.
   *
   * Toll and Tunnel are reachable through a foreign key, but TAR is referenced
   * by a Setting holding its UUID as TEXT, and Flat is resolved by NAME — so
   * for two of the four the database would happily delete the row and leave a
   * pricing rule pointing at nothing.
   */
  describe("a system-managed property", () => {
    it.each([
      ["a route-priced property (Toll, Tunnel)", { pricingComponentId: COMPONENT_ID }],
      ["the automatic property (TAR)", { name: "TAR" }],
      ["the container-type property (Flat)", { name: "Flat" }],
    ])("refuses to delete %s", async (_label, overrides) => {
      repository.findById.mockResolvedValue(buildProperty(overrides));

      await expect(service.remove(PROPERTY_ID)).rejects.toBeInstanceOf(
        SystemManagedCustomPropertyDeletionException,
      );
      expect(repository.delete).not.toHaveBeenCalled();
    });

    it("explains why, in the words the assignment guard already uses", async () => {
      repository.findById.mockResolvedValue(buildProperty({ name: "TAR" }));

      await expect(service.remove(PROPERTY_ID)).rejects.toThrow(
        /the Pricing Engine applies it automatically/,
      );
    });

    /** The catalog compares names trimmed and case-insensitively. */
    it("is not fooled by casing or padding", async () => {
      repository.findById.mockResolvedValue(buildProperty({ name: "  tar  " }));

      await expect(service.remove(PROPERTY_ID)).rejects.toBeInstanceOf(
        SystemManagedCustomPropertyDeletionException,
      );
    });

    /** Checked before the counts: it is a fact about the property itself. */
    it("does not even count dependencies", async () => {
      repository.findById.mockResolvedValue(buildProperty({ name: "Flat" }));

      await expect(service.remove(PROPERTY_ID)).rejects.toThrow();

      expect(repository.countAssignments).not.toHaveBeenCalled();
    });
  });

  describe("deleting one that is not there", () => {
    it("reports it as not found", async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.remove(PROPERTY_ID)).rejects.toBeInstanceOf(
        CustomPropertyNotFoundException,
      );
    });

    /** A double-clicked button: the second attempt is a clean 404, not a crash. */
    it("answers a second delete of the same property the same way", async () => {
      await service.remove(PROPERTY_ID);
      repository.findById.mockResolvedValue(null);

      await expect(service.remove(PROPERTY_ID)).rejects.toBeInstanceOf(
        CustomPropertyNotFoundException,
      );
      expect(repository.delete).toHaveBeenCalledTimes(1);
    });
  });
});
