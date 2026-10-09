import { Injectable } from "@nestjs/common";

import { CostConfirmationReadService } from "../cost-confirmations/cost-confirmation-read.service";
import { AppLoggerService } from "../logger/app-logger.service";
import {
  PRICING_SETTINGS_CATEGORY,
  PricingSettingKey,
} from "../pricing-engine/pricing-settings";
import { SettingNotFoundException } from "../settings/exceptions/setting.exceptions";
import { SettingsService } from "../settings/settings.service";
import { TripPricingService } from "../trip-pricing/trip-pricing.service";
import { TripService } from "../trips/trip.service";
import {
  DEFAULT_NEXT_DAY_WORD,
  DEFAULT_WAITING_WORD,
  toTripExportLabels,
  type TripExportLabels,
} from "./trip-export-labels";

/**
 * The export words of many Trips, read together.
 *
 * Gathers exactly what `toTripExportLabels` needs and nothing more: each Trip
 * as the API describes it, its stored pricing snapshot, and which Custom
 * Property is TAR. Three batched reads, whatever the number of Trips — the
 * same reads the browser's export used to make itself.
 *
 * Reading never prices anything, and nothing is stored.
 */
@Injectable()
export class TripExportLabelsService {
  constructor(
    private readonly trips: TripService,
    private readonly pricing: TripPricingService,
    private readonly settings: SettingsService,
    private readonly costConfirmations: CostConfirmationReadService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(TripExportLabelsService.name);
  }

  async findForTrips(
    tripIds: readonly string[],
    waitingWord: string = DEFAULT_WAITING_WORD,
    nextDayWord: string = DEFAULT_NEXT_DAY_WORD,
  ): Promise<Map<string, TripExportLabels>> {
    if (tripIds.length === 0) {
      return new Map();
    }

    const [trips, snapshots, automaticPropertyId, confirmations] =
      await Promise.all([
        this.trips.findManyByIds(tripIds),
        // CURRENT snapshots only: an OPEN Trip's old one describes no charge.
        this.pricing.findManyByTripIds(tripIds),
        this.automaticPropertyId(),
        // The records themselves, whatever the Trip's status.
        this.costConfirmations.findNumbersForTrips(tripIds),
      ]);

    const snapshotByTrip = new Map(
      snapshots.map((snapshot) => [snapshot.pricing.tripId, snapshot]),
    );

    return new Map(
      trips.map((trip) => [
        trip.id,
        toTripExportLabels(
          trip,
          snapshotByTrip.get(trip.id) ?? null,
          automaticPropertyId,
          confirmations.get(trip.id) ?? [],
          waitingWord,
          nextDayWord,
        ),
      ]),
    );
  }

  /**
   * The Custom Property the Engine applies on its own — TAR — or null.
   *
   * Needed to RECOGNISE its line in a stored snapshot; whether TAR applied is
   * never decided here. A deployment that has not configured it yet is an
   * ordinary state, exactly as the browser export treated it: no line can be
   * recognised, and no TAR is named. Any other failure is not swallowed.
   */
  private async automaticPropertyId(): Promise<string | null> {
    try {
      const setting = await this.settings.findOne(
        PRICING_SETTINGS_CATEGORY,
        PricingSettingKey.AUTOMATIC_CUSTOM_PROPERTY_ID,
      );
      const value = String(setting.value ?? "").trim();

      return value === "" ? null : value;
    } catch (error: unknown) {
      if (error instanceof SettingNotFoundException) {
        this.logger.log("No automatic Custom Property is configured; TAR is not labelled");

        return null;
      }

      throw error;
    }
  }
}
