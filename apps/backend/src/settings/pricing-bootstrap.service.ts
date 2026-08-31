import { Injectable } from "@nestjs/common";

import { CustomPropertyService } from "../custom-properties/custom-property.service";
import { AppLoggerService } from "../logger/app-logger.service";
import {
  AUTOMATIC_CUSTOM_PROPERTY_NAME,
  AUTOMATIC_CUSTOM_PROPERTY_SETTING_KEY,
  PRICING_CATEGORY,
  PRICING_SETTING_CATALOG,
} from "./pricing-settings.catalog";
import { SettingsRepository } from "./settings.repository";
import { SettingsService } from "./settings.service";

/**
 * What one pricing setting looks like right now, and what bootstrapping it
 * would do.
 */
export interface PricingSettingStatus {
  readonly key: string;
  /** The configured value, or null when the setting does not exist yet. */
  readonly value: string | null;
  /** True when a row exists, whether or not it is switched on. */
  readonly isConfigured: boolean;
  /**
   * False when the row exists but is switched OFF.
   *
   * The Engine treats an inactive setting exactly as it treats a missing one
   * and refuses to price, so this is reported rather than silently repaired:
   * somebody disabled it deliberately, and reactivating it is their decision.
   */
  readonly isActive: boolean;
  /**
   * What bootstrapping would write, or null when it can do nothing.
   *
   * Null on a setting that is already configured — bootstrapping never
   * overwrites — and null on one whose value cannot be determined, which is
   * reported through `blockedReason` rather than filled in with a guess.
   */
  readonly proposedValue: string | null;
  /** Why this setting cannot be created automatically, when it cannot. */
  readonly blockedReason: string | null;
}

/** Everything bootstrapping would do, before it does any of it. */
export interface PricingBootstrapPlan {
  readonly settings: readonly PricingSettingStatus[];
  readonly missingCount: number;
  readonly creatableCount: number;
  readonly blockedCount: number;
}

/**
 * Bringing an unconfigured database to the point where pricing can run.
 *
 * ── THE STATE THIS EXISTS FOR ───────────────────────────────────────────────
 * A fresh deployment has migrations but no pricing settings, because the seed
 * deliberately writes none — inventing a monetary value would be worse than
 * writing nothing. The consequence was not anticipated: the Engine refuses
 * every calculation, no snapshot is ever written, the whole pricing screen is
 * empty, and nothing in the application could fix it because settings could
 * only be edited, never created.
 *
 * This service closes that gap without reopening the one the seed avoided. It
 * writes only what the pricing catalog declares, only where nothing is
 * configured, and it SHOWS what it will write first.
 *
 * ── IT NEVER OVERWRITES ─────────────────────────────────────────────────────
 * A configured setting is somebody's decision. Bootstrapping is for the state
 * where no decision has been recorded at all, so an existing row is reported
 * and left exactly as it is — including one whose value differs from the
 * catalog's, which is an operator's deliberate change rather than drift to be
 * corrected.
 *
 * ── AND IT NEVER PRICES ANYTHING ────────────────────────────────────────────
 * It holds no Engine, no Trip service and no snapshot writer. Configuration
 * becomes effective for the NEXT calculation — a Trip closing afterwards, or an
 * explicit reprocess. No historical Trip is touched, and none is repriced
 * merely because configuration appeared.
 * ────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class PricingBootstrapService {
  constructor(
    private readonly settings: SettingsService,
    private readonly repository: SettingsRepository,
    /*
     * To resolve the automatic property's id from THIS database. A UUID copied
     * from another environment would point at nothing, or at some unrelated
     * property — which would silently charge the wrong amount on every Trip.
     */
    private readonly customProperties: CustomPropertyService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(PricingBootstrapService.name);
  }

  /**
   * What bootstrapping would do. Writes nothing.
   *
   * The report an operator reads before deciding, and the same shape the
   * Configuration page renders as a list of settings with their values.
   */
  async plan(): Promise<PricingBootstrapPlan> {
    const configured = await this.configuredRows();
    const automaticPropertyId = await this.findAutomaticPropertyId();

    const settings = PRICING_SETTING_CATALOG.map((definition) => {
      const existing = configured.get(definition.key);

      if (existing) {
        return {
          key: definition.key,
          value: existing.value,
          isConfigured: true,
          isActive: existing.isActive,
          proposedValue: null,
          blockedReason: existing.isActive
            ? null
            : "This setting exists but is switched off. The Pricing Engine treats it exactly as missing and will refuse to price until it is active again.",
        };
      }

      /*
       * The one value that cannot be written down in advance: it is an id in
       * this database. Resolved by NAME, and reported as blocked rather than
       * guessed when the property does not exist.
       */
      if (definition.key === AUTOMATIC_CUSTOM_PROPERTY_SETTING_KEY) {
        return {
          key: definition.key,
          value: null,
          isConfigured: false,
          isActive: false,
          proposedValue: automaticPropertyId,
          blockedReason:
            automaticPropertyId === null
              ? `No active Custom Property named "${AUTOMATIC_CUSTOM_PROPERTY_NAME}" exists in this database, so its id cannot be resolved. Create the property first.`
              : null,
        };
      }

      return {
        key: definition.key,
        value: null,
        isConfigured: false,
        isActive: false,
        proposedValue: definition.defaultValue,
        blockedReason:
          definition.defaultValue === null
            ? "This setting has no value that can be determined automatically."
            : null,
      };
    });

    return {
      settings,
      missingCount: settings.filter((setting) => !setting.isConfigured).length,
      creatableCount: settings.filter(
        (setting) => !setting.isConfigured && setting.proposedValue !== null,
      ).length,
      /*
       * Anything an operator must act on before pricing can run: a setting with
       * no determinable value, and one that exists but is switched off.
       */
      blockedCount: settings.filter(
        (setting) => setting.blockedReason !== null,
      ).length,
    };
  }

  /**
   * Creates every missing setting that has a determinable value.
   *
   * Idempotent by construction: it writes only what the plan reports as
   * missing, so running it twice creates nothing the second time. A blocked
   * setting is skipped and stays in the returned plan, so the operator can see
   * what still needs their attention.
   */
  async apply(): Promise<PricingBootstrapPlan> {
    const plan = await this.plan();

    for (const setting of plan.settings) {
      if (setting.isConfigured || setting.proposedValue === null) {
        continue;
      }

      await this.settings.upsert(PRICING_CATEGORY, setting.key, {
        value: setting.proposedValue,
      });
    }

    const applied = await this.plan();

    // Keys only. The values are commercial configuration and stay out of the
    // log, exactly as every other settings write does.
    this.logger.log("Pricing configuration bootstrapped", {
      created: plan.creatableCount,
      stillMissing: applied.missingCount,
      blocked: applied.blockedCount,
    });

    return applied;
  }

  /**
   * Every pricing setting that already has a row, by key.
   *
   * INACTIVE rows are included. A switched-off setting exists, and treating it
   * as missing would have the bootstrap write over a value somebody disabled on
   * purpose — the unique index makes a second row impossible, so the write
   * would land on the existing one.
   */
  private async configuredRows(): Promise<
    Map<string, { value: string; isActive: boolean }>
  > {
    const rows = await this.repository.findMany({
      category: PRICING_CATEGORY,
      includeInactive: true,
    });

    return new Map(
      rows.map(
        (row) => [row.key, { value: row.value, isActive: row.isActive }] as const,
      ),
    );
  }

  /**
   * The automatic Custom Property's id in THIS database, or null.
   *
   * By name, through the service that owns the rule — the same lookup the Flat
   * container rule uses — so there is one definition of how a property is found
   * by name and no second copy to drift.
   */
  private async findAutomaticPropertyId(): Promise<string | null> {
    const property = await this.customProperties.findActiveByName(
      AUTOMATIC_CUSTOM_PROPERTY_NAME,
    );

    return property?.id ?? null;
  }
}
