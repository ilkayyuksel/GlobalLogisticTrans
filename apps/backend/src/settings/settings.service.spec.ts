import { Setting, SettingValueType } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { ListSettingsQueryDto } from "./dto/list-settings-query.dto";
import {
  InvalidSettingValueException,
  SettingNotFoundException,
} from "./exceptions/setting.exceptions";
import { SettingsRepository } from "./settings.repository";
import { SettingsService } from "./settings.service";
import { SettingValueValidator } from "./validators/setting-value.validator";

function buildSetting(overrides: Partial<Setting> = {}): Setting {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    category: "PRICING",
    key: "FUEL_PERCENTAGE",
    value: "15",
    valueType: SettingValueType.DECIMAL,
    description: "Fuel surcharge percentage.",
    defaultValue: null,
    isActive: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("SettingsService", () => {
  let repository: jest.Mocked<SettingsRepository>;
  let logger: jest.Mocked<AppLoggerService>;
  let service: SettingsService;

  beforeEach(() => {
    repository = {
      findMany: jest.fn(),
      findByCategoryAndKey: jest.fn(),
      updateValue: jest.fn(),
    } as unknown as jest.Mocked<SettingsRepository>;

    logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    } as unknown as jest.Mocked<AppLoggerService>;

    // The real validator is used rather than a mock: its rules are the feature
    // under test, and stubbing them would make these tests prove nothing.
    service = new SettingsService(repository, new SettingValueValidator(), logger);
  });

  function query(overrides: Partial<ListSettingsQueryDto> = {}) {
    return { includeInactive: false, ...overrides } as ListSettingsQueryDto;
  }

  describe("findAll", () => {
    it("maps entities to the response shape without leaking extra fields", async () => {
      repository.findMany.mockResolvedValue([buildSetting()]);

      const [result] = await service.findAll(query());

      expect(Object.keys(result).sort()).toEqual([
        "category",
        "createdAt",
        "defaultValue",
        "description",
        "id",
        "isActive",
        "key",
        "updatedAt",
        "value",
        "valueType",
      ]);
    });

    it("passes the category filter and active-only default to the repository", async () => {
      repository.findMany.mockResolvedValue([]);

      await service.findAll(query({ category: "PRICING" }));

      expect(repository.findMany).toHaveBeenCalledWith({
        category: "PRICING",
        includeInactive: false,
      });
    });

    it("forwards includeInactive when requested", async () => {
      repository.findMany.mockResolvedValue([]);

      await service.findAll(query({ includeInactive: true }));

      expect(repository.findMany).toHaveBeenCalledWith({
        category: undefined,
        includeInactive: true,
      });
    });
  });

  describe("findGroupedByCategory", () => {
    it("groups settings and preserves repository ordering", async () => {
      repository.findMany.mockResolvedValue([
        buildSetting({ id: "a", category: "GENERAL", key: "COMPANY_NAME" }),
        buildSetting({ id: "b", category: "PRICING", key: "FUEL_PERCENTAGE" }),
        buildSetting({ id: "c", category: "PRICING", key: "PRICING_STRATEGY" }),
      ]);

      const groups = await service.findGroupedByCategory(query());

      expect(groups).toHaveLength(2);
      expect(groups[0].category).toBe("GENERAL");
      expect(groups[0].settings).toHaveLength(1);
      expect(groups[1].category).toBe("PRICING");
      expect(groups[1].settings.map((s) => s.key)).toEqual([
        "FUEL_PERCENTAGE",
        "PRICING_STRATEGY",
      ]);
    });

    it("returns an empty array when nothing matches", async () => {
      repository.findMany.mockResolvedValue([]);

      expect(await service.findGroupedByCategory(query())).toEqual([]);
    });
  });

  describe("findOne", () => {
    it("returns the setting when it exists", async () => {
      repository.findByCategoryAndKey.mockResolvedValue(buildSetting());

      const result = await service.findOne("PRICING", "FUEL_PERCENTAGE");

      expect(result.key).toBe("FUEL_PERCENTAGE");
      expect(repository.findByCategoryAndKey).toHaveBeenCalledWith(
        "PRICING",
        "FUEL_PERCENTAGE",
      );
    });

    it("throws SettingNotFoundException when it does not exist", async () => {
      repository.findByCategoryAndKey.mockResolvedValue(null);

      await expect(service.findOne("PRICING", "MISSING")).rejects.toThrow(
        SettingNotFoundException,
      );
    });
  });

  describe("update", () => {
    it("persists a value that matches the configured type", async () => {
      const setting = buildSetting();
      repository.findByCategoryAndKey.mockResolvedValue(setting);
      repository.updateValue.mockResolvedValue(
        buildSetting({ value: "18.5" }),
      );

      const result = await service.update("PRICING", "FUEL_PERCENTAGE", {
        value: "18.5",
      });

      expect(repository.updateValue).toHaveBeenCalledWith(setting.id, "18.5");
      expect(result.value).toBe("18.5");
    });

    it("rejects a value that does not match the configured type", async () => {
      repository.findByCategoryAndKey.mockResolvedValue(
        buildSetting({ valueType: SettingValueType.INTEGER }),
      );

      await expect(
        service.update("PRICING", "FUEL_PERCENTAGE", { value: "not-a-number" }),
      ).rejects.toThrow(InvalidSettingValueException);

      expect(repository.updateValue).not.toHaveBeenCalled();
    });

    /**
     * A few settings carry a numeric bound their value type cannot express.
     * pricing_rules.md makes a positive waiting-time block size a configuration
     * validation rule, because zero leaves the pricing formula undefined.
     */
    describe("numeric bounds", () => {
      function blockMinutes(value: string) {
        repository.findByCategoryAndKey.mockResolvedValue(
          buildSetting({
            category: "PRICING",
            key: "WAITING_TIME_BLOCK_MINUTES",
            valueType: SettingValueType.INTEGER,
            value: "30",
          }),
        );

        return service.update("PRICING", "WAITING_TIME_BLOCK_MINUTES", {
          value,
        });
      }

      it("rejects a waiting-time block size of zero", async () => {
        await expect(blockMinutes("0")).rejects.toThrow(
          InvalidSettingValueException,
        );

        expect(repository.updateValue).not.toHaveBeenCalled();
      });

      it("rejects a negative waiting-time block size", async () => {
        await expect(blockMinutes("-30")).rejects.toThrow(
          InvalidSettingValueException,
        );
      });

      it("accepts the smallest usable block size", async () => {
        repository.updateValue.mockResolvedValue(buildSetting({ value: "1" }));

        await expect(blockMinutes("1")).resolves.toBeDefined();
        expect(repository.updateValue).toHaveBeenCalled();
      });

      /**
       * pricing_rules.md § Business Constraints: negative pricing is not
       * supported. Each of these values feeds an amount directly.
       */
      describe("pricing amounts", () => {
        const AMOUNT_KEYS = [
          "FUEL_PERCENTAGE",
          "COMBINATION_SURCHARGE",
          "DISTANCE_RATE_PER_KM",
          "WAITING_TIME_BLOCK_PRICE",
        ];

        function updateAmount(key: string, value: string) {
          repository.findByCategoryAndKey.mockResolvedValue(
            buildSetting({
              category: "PRICING",
              key,
              valueType: SettingValueType.DECIMAL,
              value: "15",
            }),
          );

          return service.update("PRICING", key, { value });
        }

        it.each(AMOUNT_KEYS)("rejects a negative %s", async (key) => {
          await expect(updateAmount(key, "-1")).rejects.toThrow(
            InvalidSettingValueException,
          );

          expect(repository.updateValue).not.toHaveBeenCalled();
        });

        it.each(AMOUNT_KEYS)("rejects a negative decimal %s", async (key) => {
          await expect(updateAmount(key, "-0.01")).rejects.toThrow(
            InvalidSettingValueException,
          );
        });

        it.each(AMOUNT_KEYS)("accepts a zero %s", async (key) => {
          repository.updateValue.mockResolvedValue(buildSetting({ value: "0" }));

          await expect(updateAmount(key, "0")).resolves.toBeDefined();
          expect(repository.updateValue).toHaveBeenCalled();
        });

        it.each(AMOUNT_KEYS)("accepts a two-decimal zero %s", async (key) => {
          repository.updateValue.mockResolvedValue(
            buildSetting({ value: "0.00" }),
          );

          await expect(updateAmount(key, "0.00")).resolves.toBeDefined();
        });

        it.each(AMOUNT_KEYS)("accepts a positive decimal %s", async (key) => {
          repository.updateValue.mockResolvedValue(
            buildSetting({ value: "12.75" }),
          );

          await expect(updateAmount(key, "12.75")).resolves.toBeDefined();
        });

        it.each(AMOUNT_KEYS)("rejects a malformed %s", async (key) => {
          await expect(updateAmount(key, "not-a-number")).rejects.toThrow(
            InvalidSettingValueException,
          );
        });

        it("reports a negative value as a bound failure, not a type failure", async () => {
          await expect(updateAmount("FUEL_PERCENTAGE", "-1")).rejects.toThrow(
            InvalidSettingValueException,
          );

          expect(logger.warn).toHaveBeenCalledWith(
            "Rejected setting value",
            expect.objectContaining({ reason: "value must be at least 0" }),
          );
        });

        it("never writes the rejected amount into the logs", async () => {
          await expect(
            updateAmount("COMBINATION_SURCHARGE", "-1234.56"),
          ).rejects.toThrow(InvalidSettingValueException);

          expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(
            "1234.56",
          );
        });
      });

      /**
       * pricing_rules.md states the free allowance is "zero or greater". The
       * Pricing Engine already refused a negative allowance; this closes the
       * gap on the write side so both layers agree.
       */
      describe("the waiting-time free allowance", () => {
        function updateFreeMinutes(value: string) {
          repository.findByCategoryAndKey.mockResolvedValue(
            buildSetting({
              category: "PRICING",
              key: "WAITING_TIME_FREE_MINUTES",
              valueType: SettingValueType.INTEGER,
              value: "60",
            }),
          );

          return service.update("PRICING", "WAITING_TIME_FREE_MINUTES", {
            value,
          });
        }

        it("rejects a negative allowance", async () => {
          await expect(updateFreeMinutes("-60")).rejects.toThrow(
            InvalidSettingValueException,
          );

          expect(repository.updateValue).not.toHaveBeenCalled();
        });

        it("accepts zero, which means no free allowance", async () => {
          repository.updateValue.mockResolvedValue(buildSetting({ value: "0" }));

          await expect(updateFreeMinutes("0")).resolves.toBeDefined();
          expect(repository.updateValue).toHaveBeenCalled();
        });

        it("accepts a positive allowance", async () => {
          repository.updateValue.mockResolvedValue(
            buildSetting({ value: "90" }),
          );

          await expect(updateFreeMinutes("90")).resolves.toBeDefined();
        });

        it("rejects a fractional allowance as a type failure", async () => {
          await expect(updateFreeMinutes("1.5")).rejects.toThrow(
            InvalidSettingValueException,
          );

          expect(logger.warn).toHaveBeenCalledWith(
            "Rejected setting value",
            expect.objectContaining({ reason: "value must be a whole number" }),
          );
        });

        it("rejects a malformed allowance", async () => {
          await expect(updateFreeMinutes("not-a-number")).rejects.toThrow(
            InvalidSettingValueException,
          );
        });
      });

      it("leaves settings without a bound alone", async () => {
        // Bounds are per setting, not a blanket rule: a setting with no entry
        // in the registry accepts any value its type allows, sign included.
        repository.findByCategoryAndKey.mockResolvedValue(
          buildSetting({
            category: "GENERAL",
            key: "SOME_UNBOUNDED_SETTING",
            valueType: SettingValueType.DECIMAL,
            value: "1",
          }),
        );
        repository.updateValue.mockResolvedValue(buildSetting({ value: "-5" }));

        await expect(
          service.update("GENERAL", "SOME_UNBOUNDED_SETTING", { value: "-5" }),
        ).resolves.toBeDefined();
        expect(repository.updateValue).toHaveBeenCalled();
      });

      it("checks the type before the bound", async () => {
        // A non-numeric value must fail as a type error, not as a bound error.
        await expect(blockMinutes("not-a-number")).rejects.toThrow(
          InvalidSettingValueException,
        );

        expect(logger.warn).toHaveBeenCalledWith(
          "Rejected setting value",
          expect.objectContaining({ reason: "value must be a whole number" }),
        );
      });
    });

    it("throws SettingNotFoundException before validating", async () => {
      repository.findByCategoryAndKey.mockResolvedValue(null);

      await expect(
        service.update("PRICING", "MISSING", { value: "1" }),
      ).rejects.toThrow(SettingNotFoundException);

      expect(repository.updateValue).not.toHaveBeenCalled();
    });

    it("never writes the value into the logs", async () => {
      const secret = "super-secret-imap-password";
      repository.findByCategoryAndKey.mockResolvedValue(
        buildSetting({
          category: "IMPORT",
          key: "IMAP_PASSWORD",
          valueType: SettingValueType.STRING,
        }),
      );
      repository.updateValue.mockResolvedValue(
        buildSetting({ value: secret }),
      );

      await service.update("IMPORT", "IMAP_PASSWORD", { value: secret });

      const logged = JSON.stringify(logger.log.mock.calls);
      expect(logged).not.toContain(secret);
      expect(logger.log).toHaveBeenCalledWith(
        "Setting updated",
        expect.objectContaining({ category: "IMPORT", key: "IMAP_PASSWORD" }),
      );
    });

    it("logs a rejected value as a warning without the value", async () => {
      repository.findByCategoryAndKey.mockResolvedValue(
        buildSetting({ valueType: SettingValueType.BOOLEAN }),
      );

      await expect(
        service.update("PRICING", "FUEL_PERCENTAGE", { value: "maybe" }),
      ).rejects.toThrow(InvalidSettingValueException);

      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("maybe");
    });
  });
});
