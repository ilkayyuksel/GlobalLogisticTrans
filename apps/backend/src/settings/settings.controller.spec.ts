import { ListSettingsQueryDto } from "./dto/list-settings-query.dto";
import { SettingsController } from "./settings.controller";
import { PricingBootstrapService } from "./pricing-bootstrap.service";
import { SettingsService } from "./settings.service";

const EMPTY_PLAN = {
  settings: [],
  missingCount: 0,
  creatableCount: 0,
  blockedCount: 0,
};

describe("SettingsController", () => {
  let service: jest.Mocked<SettingsService>;
  let bootstrap: jest.Mocked<PricingBootstrapService>;
  let controller: SettingsController;

  beforeEach(() => {
    service = {
      findAll: jest.fn().mockResolvedValue([]),
      findGroupedByCategory: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      upsert: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<SettingsService>;

    bootstrap = {
      plan: jest.fn().mockResolvedValue(EMPTY_PLAN),
      apply: jest.fn().mockResolvedValue(EMPTY_PLAN),
    } as unknown as jest.Mocked<PricingBootstrapService>;

    controller = new SettingsController(service, bootstrap);
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

  it("passes params and body separately when upserting", async () => {
    const dto = { value: "18" };

    await controller.upsert(
      { category: "PRICING", key: "FUEL_PERCENTAGE" },
      dto,
    );

    expect(service.upsert).toHaveBeenCalledWith(
      "PRICING",
      "FUEL_PERCENTAGE",
      dto,
    );
  });

  it("delegates the bootstrap plan to the service", async () => {
    await controller.planPricingBootstrap();

    expect(bootstrap.plan).toHaveBeenCalledTimes(1);
    expect(bootstrap.apply).not.toHaveBeenCalled();
  });

  it("delegates applying the bootstrap to the service", async () => {
    await controller.applyPricingBootstrap();

    expect(bootstrap.apply).toHaveBeenCalledTimes(1);
  });
});
