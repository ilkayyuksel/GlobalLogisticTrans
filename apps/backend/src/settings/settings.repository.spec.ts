import { PrismaService } from "../prisma/prisma.service";
import { SettingsRepository } from "./settings.repository";

/**
 * Verifies the exact Prisma queries. The point is the shape of the `where`,
 * `orderBy` and `data` arguments — a wrong filter here silently returns the
 * wrong settings rather than failing.
 */
describe("SettingsRepository", () => {
  let prisma: {
    setting: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };
  let repository: SettingsRepository;

  beforeEach(() => {
    prisma = {
      setting: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    repository = new SettingsRepository(prisma as unknown as PrismaService);
  });

  describe("findMany", () => {
    it("filters to active settings by default and orders by category then key", async () => {
      await repository.findMany({ includeInactive: false });

      expect(prisma.setting.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
        orderBy: [{ category: "asc" }, { key: "asc" }],
      });
    });

    it("omits the isActive filter when inactive settings are requested", async () => {
      await repository.findMany({ includeInactive: true });

      expect(prisma.setting.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: [{ category: "asc" }, { key: "asc" }],
      });
    });

    it("adds the category filter when provided", async () => {
      await repository.findMany({ category: "PRICING", includeInactive: false });

      expect(prisma.setting.findMany).toHaveBeenCalledWith({
        where: { category: "PRICING", isActive: true },
        orderBy: [{ category: "asc" }, { key: "asc" }],
      });
    });
  });

  describe("findByCategoryAndKey", () => {
    it("uses the composite unique index", async () => {
      await repository.findByCategoryAndKey("PRICING", "FUEL_PERCENTAGE");

      expect(prisma.setting.findUnique).toHaveBeenCalledWith({
        where: {
          category_key: { category: "PRICING", key: "FUEL_PERCENTAGE" },
        },
      });
    });
  });

  describe("updateValue", () => {
    it("updates by primary key and touches only the value column", async () => {
      await repository.updateValue("setting-id", "18");

      expect(prisma.setting.update).toHaveBeenCalledWith({
        where: { id: "setting-id" },
        data: { value: "18" },
      });
    });

    it("never includes category or key in the update payload", async () => {
      await repository.updateValue("setting-id", "18");

      const [[call]] = prisma.setting.update.mock.calls as [
        [{ data: Record<string, unknown> }],
      ];

      expect(Object.keys(call.data)).toEqual(["value"]);
    });
  });
});
