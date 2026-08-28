import { CustomPropertyService } from "../custom-properties/custom-property.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { TripCustomPropertyRepository } from "../trip-custom-properties/trip-custom-property.repository";
import { AutomaticFlatPropertyService } from "./automatic-flat.service";
import { MissingRequiredCustomPropertyException } from "./exceptions/trip.exceptions";

const TRIP_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const FLAT_ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const TAR_ID = "2c9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";

/** The property as an administrator configured it, price and all. */
const FLAT = {
  id: FLAT_ID,
  name: "Flat",
  defaultPrice: "80.00",
  pricingComponentId: null,
  isActive: true,
};

interface Row {
  id: string;
  tripId: string;
  customPropertyId: string;
  isAutomatic: boolean;
}

/**
 * Keeping Flat in step with the container type.
 *
 * ── WHAT THESE TESTS ARE REALLY ABOUT ───────────────────────────────────────
 * Two things the rule must never do, both invisible until somebody notices a
 * wrong invoice months later:
 *
 *   1. leave a Flat behind on a Trip that stopped being a flat rack, which
 *      charges for handling nobody did;
 *   2. take away a Flat an OPERATOR assigned, which un-charges for handling
 *      somebody did — and leaves no trace that it was ever there.
 *
 * The second is why `isAutomatic` exists at all, so most of what follows is
 * about which rows the rule is allowed to touch.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The assignment table is in memory and the rule is real, so what is asserted
 * is the rows it leaves behind rather than the calls it made.
 */
describe("AutomaticFlatPropertyService", () => {
  let rows: Row[];
  let repository: TripCustomPropertyRepository;
  let customProperties: { findActiveByName: jest.Mock };
  let logger: jest.Mocked<AppLoggerService>;
  let service: AutomaticFlatPropertyService;

  beforeEach(() => {
    rows = [];

    repository = {
      findByTripAndProperty: jest.fn((tripId: string, propertyId: string) =>
        Promise.resolve(
          rows.find(
            (row) => row.tripId === tripId && row.customPropertyId === propertyId,
          ) ?? null,
        ),
      ),
      create: jest.fn((data: Omit<Row, "id">) => {
        const row = { id: `assignment-${rows.length + 1}`, ...data };
        rows.push(row);
        return Promise.resolve(row);
      }),
      delete: jest.fn((id: string) => {
        const index = rows.findIndex((row) => row.id === id);
        const [removed] = rows.splice(index, 1);
        return Promise.resolve(removed);
      }),
    } as unknown as TripCustomPropertyRepository;

    customProperties = {
      findActiveByName: jest.fn((name: string) =>
        Promise.resolve(name === "Flat" ? FLAT : null),
      ),
    };

    logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    } as unknown as jest.Mocked<AppLoggerService>;

    service = new AutomaticFlatPropertyService(
      customProperties as unknown as CustomPropertyService,
      logger,
    );
  });

  /** Puts a row on the Trip the way one of the two sources would have. */
  function given(customPropertyId: string, isAutomatic: boolean): Row {
    const row = {
      id: `existing-${rows.length + 1}`,
      tripId: TRIP_ID,
      customPropertyId,
      isAutomatic,
    };
    rows.push(row);

    return row;
  }

  function flatRow(): Row | undefined {
    return rows.find((row) => row.customPropertyId === FLAT_ID);
  }

  describe("a Trip that has just been created", () => {
    it.each(["20FL", "20ST", "20fl"])("assigns Flat for %s", async (type) => {
      await service.applyToNewTrip(repository, TRIP_ID, type);

      expect(flatRow()).toMatchObject({ tripId: TRIP_ID, isAutomatic: true });
    });

    it.each(["45PH", "45OS", "20STUFF", null])(
      "assigns nothing for %p",
      async (type) => {
        await service.applyToNewTrip(repository, TRIP_ID, type);

        expect(rows).toHaveLength(0);
      },
    );

    /**
     * Most Trips are 45PH and this runs inside every import, so a type that
     * requires nothing must not cost a lookup. Cheap to keep true, easy to
     * lose by accident.
     */
    it("does not even look the property up when nothing is required", async () => {
      await service.applyToNewTrip(repository, TRIP_ID, "45PH");

      expect(customProperties.findActiveByName).not.toHaveBeenCalled();
    });

    it("finds the property by name, never by a hardcoded id", async () => {
      await service.applyToNewTrip(repository, TRIP_ID, "20FL");

      expect(customProperties.findActiveByName).toHaveBeenCalledWith("Flat");
      expect(flatRow()?.customPropertyId).toBe(FLAT_ID);
    });

    /**
     * A 20FL stored without its Flat would be under-charged for the rest of its
     * life, with nothing on the Trip to show why. Refusing rolls the Trip back
     * with it, because this runs inside the Trip's own transaction.
     */
    it("refuses when no Flat property is configured", async () => {
      customProperties.findActiveByName.mockResolvedValue(null);

      await expect(
        service.applyToNewTrip(repository, TRIP_ID, "20FL"),
      ).rejects.toBeInstanceOf(MissingRequiredCustomPropertyException);
      expect(rows).toHaveLength(0);
    });

    it("logs a missing configuration rather than passing over it", async () => {
      customProperties.findActiveByName.mockResolvedValue(null);

      await expect(
        service.applyToNewTrip(repository, TRIP_ID, "20FL"),
      ).rejects.toBeDefined();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("a Trip whose container type has changed", () => {
    it("assigns Flat when the type starts requiring it", async () => {
      await service.synchronise(repository, TRIP_ID, "20FL");

      expect(flatRow()).toMatchObject({ isAutomatic: true });
    });

    it("removes its own assignment when the type stops requiring it", async () => {
      given(FLAT_ID, true);

      await service.synchronise(repository, TRIP_ID, "45PH");

      expect(flatRow()).toBeUndefined();
    });

    it.each(["45OS", "45RH", "45PH"])(
      "removes it when the type becomes %s",
      async (type) => {
        given(FLAT_ID, true);

        await service.synchronise(repository, TRIP_ID, type);

        expect(flatRow()).toBeUndefined();
      },
    );

    /** The reason `isAutomatic` exists. */
    it("leaves a manually assigned Flat exactly where it is", async () => {
      const manual = given(FLAT_ID, false);

      await service.synchronise(repository, TRIP_ID, "45PH");

      expect(flatRow()).toEqual(manual);
      expect(repository.delete).not.toHaveBeenCalled();
    });

    it("changes nothing when the type still requires it", async () => {
      const existing = given(FLAT_ID, true);

      await service.synchronise(repository, TRIP_ID, "20ST");

      expect(rows).toEqual([existing]);
      expect(repository.create).not.toHaveBeenCalled();
    });

    /**
     * A manual Flat already satisfies the invariant, so the rule adds nothing
     * beside it — the unique pair index would refuse a second row anyway — and
     * it does NOT take the row over. Who assigned it stays true.
     */
    it("neither duplicates nor adopts a manual Flat on a 20FL Trip", async () => {
      given(FLAT_ID, false);

      await service.synchronise(repository, TRIP_ID, "20FL");

      expect(rows).toHaveLength(1);
      expect(flatRow()?.isAutomatic).toBe(false);
    });

    it("is idempotent when run again with the same type", async () => {
      await service.synchronise(repository, TRIP_ID, "20FL");
      await service.synchronise(repository, TRIP_ID, "20FL");
      await service.synchronise(repository, TRIP_ID, "20FL");

      expect(rows).toHaveLength(1);
    });

    it("adds it back when the type returns to a flat rack", async () => {
      await service.synchronise(repository, TRIP_ID, "20FL");
      await service.synchronise(repository, TRIP_ID, "45PH");
      await service.synchronise(repository, TRIP_ID, "20ST");

      expect(flatRow()).toMatchObject({ isAutomatic: true });
      expect(rows).toHaveLength(1);
    });

    /** Only Flat. Every other property on the Trip is somebody else's business. */
    it("never touches another property", async () => {
      const tar = given(TAR_ID, false);

      await service.synchronise(repository, TRIP_ID, "20FL");
      await service.synchronise(repository, TRIP_ID, "45PH");

      expect(rows).toEqual([tar]);
    });

    it("does nothing at all when no Flat is configured and none is required", async () => {
      customProperties.findActiveByName.mockResolvedValue(null);
      const tar = given(TAR_ID, false);

      await service.synchronise(repository, TRIP_ID, "45PH");

      expect(rows).toEqual([tar]);
    });

    it("refuses when no Flat is configured but one is required", async () => {
      customProperties.findActiveByName.mockResolvedValue(null);

      await expect(
        service.synchronise(repository, TRIP_ID, "20FL"),
      ).rejects.toBeInstanceOf(MissingRequiredCustomPropertyException);
    });
  });
});
