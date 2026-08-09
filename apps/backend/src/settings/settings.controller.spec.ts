import { ListSettingsQueryDto } from "./dto/list-settings-query.dto";
import { SettingsController } from "./settings.controller";
import { SettingsService } from "./settings.service";

describe("SettingsController", () => {
  let service: jest.Mocked<SettingsService>;
  let controller: SettingsController;

  beforeEach(() => {
    service = {
      findAll: jest.fn().mockResolvedValue([]),
      findGroupedByCategory: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<SettingsService>;

    controller = new SettingsController(service);
  });

  const query: ListSettingsQueryDto = { includeInactive: false };

  it("delegates listing to the service", async () => {
    await controller.findAll(query);

    expect(service.findAll).toHaveBeenCalledWith(query);
  });

  it("delegates grouping to the service", async () => {
    await controller.findGroupedByCategory(query);

    expect(service.findGroupedByCategory).toHaveBeenCalledWith(query);
  });

  it("splits the path parameters when fetching one setting", async () => {
    await controller.findOne({ category: "PRICING", key: "FUEL_PERCENTAGE" });

    expect(service.findOne).toHaveBeenCalledWith("PRICING", "FUEL_PERCENTAGE");
  });

  it("passes params and body separately when updating", async () => {
    const dto = { value: "18" };

    await controller.update(
      { category: "PRICING", key: "FUEL_PERCENTAGE" },
      dto,
    );

    expect(service.update).toHaveBeenCalledWith(
      "PRICING",
      "FUEL_PERCENTAGE",
      dto,
    );
  });
});
