import { Injectable } from "@nestjs/common";

import { CustomPropertyService } from "../custom-properties/custom-property.service";
import { AppLoggerService } from "../logger/app-logger.service";
import {
  displayOrderOf,
  PRICING_COMPONENT_CATALOG,
  ROUTE_PRICED_PROPERTY_CATALOG,
} from "./pricing-component.catalog";
import { PricingComponentRepository } from "./pricing-component.repository";
import {
  AUTOMATIC_CUSTOM_PROPERTY_DEFAULT_PRICE,
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

/** Whether one catalog component is present, and what would be done about it. */
export interface PricingComponentStatus {
  readonly code: string;
  /** True when an ACTIVE row already holds this code. */
  readonly isPresent: boolean;
}

/**
 * The Custom Property the Engine applies without anyone assigning it.
 *
 * Reported as its own section because it is neither a setting nor a component:
 * it is an ordinary Custom Property that the pricing configuration POINTS at,
 * and the setting below it cannot exist until this one does.
 */
export interface AutomaticPropertyStatus {
  readonly name: string;
  /** Its id in this database, or null when no active property has that name. */
  readonly id: string | null;
  readonly isPresent: boolean;
  /** True when bootstrapping would create it. */
  readonly willCreate: boolean;
}

/**
 * A Custom Property that makes a route-priced component applicable.
 *
 * Reported separately from the automatic property because it is a different
 * kind of thing: it carries no amount of its own, and it exists so a route cost
 * for its component can be stored and read at all.
 */
export interface RoutePricedPropertyStatus {
  readonly name: string;
  readonly componentCode: string;
  readonly isPresent: boolean;
  readonly willCreate: boolean;
  /** Set when the component itself is absent, which blocks the link. */
  readonly blockedReason: string | null;
}

/** Everything bootstrapping would do, before it does any of it. */
export interface PricingBootstrapPlan {
  /**
   * The catalog rows, and the automatic property.
   *
   * Both come BEFORE `settings` in the plan for the same reason they come
   * before it in `apply()`: a setting pointing at a property that does not
   * exist is not configuration, and a calculated line whose component is not in
   * the catalog cannot be stored at all.
   */
  readonly components: readonly PricingComponentStatus[];
  readonly componentsMissingCount: number;
  readonly automaticProperty: AutomaticPropertyStatus;
  /**
   * The per-Trip switches for the route-priced components.
   *
   * After the catalog, because a property cannot link to a component that does
   * not exist yet.
   */
  readonly routePricedProperties: readonly RoutePricedPropertyStatus[];
  readonly settings: readonly PricingSettingStatus[];
  readonly missingCount: number;
  readonly creatableCount: number;
  readonly blockedCount: number;
}

/**
 * Bringing an unconfigured database to the point where pricing can run.
 *
 * ── THE STATE THIS EXISTS FOR ───────────────────────────────────────────────
 * A fresh deployment has migrations and nothing else. The seed that holds the
 * component catalog is never run by the deployment — compose runs
 * `migrate deploy`, and `prisma db seed` needs `tsx`, which `--prod` removes
 * from the runtime image — and the seed deliberately writes no settings at all.
 * The consequence was not anticipated: the Engine refuses every calculation, no
 * snapshot is ever written, the whole pricing screen shows "—", and nothing in
 * the application could fix it.
 *
 * This service closes that gap without reopening the one the seed avoided. It
 * writes only what the pricing catalogs declare, only where nothing is
 * configured, and it SHOWS what it will write first.
 *
 * ── THE THREE LAYERS, IN THE ONLY ORDER THAT WORKS ──────────────────────────
 *   1. the `pricing_component` catalog — every pricing item carries a foreign
 *      key into it, so a breakdown cannot be STORED without it, however
 *      correctly it was calculated;
 *   2. the TAR Custom Property — an ordinary property, created only when no
 *      active one bears that name;
 *   3. the Setting rows — including the one that must hold TAR's id, which is
 *      why it cannot be written before step 2 has produced one.
 *
 * Ordering is the whole reason this is one operation rather than three. Run the
 * other way round, `AUTOMATIC_CUSTOM_PROPERTY_ID` has nothing to point at and
 * the run leaves the database still unable to price.
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
    private readonly components: PricingComponentRepository,
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
    const presentCodes = new Set(await this.components.findActiveCodes());

    const components = PRICING_COMPONENT_CATALOG.map((component) => ({
      code: component.code,
      isPresent: presentCodes.has(component.code),
    }));

    const routePricedProperties = await this.planRoutePricedProperties(
      presentCodes,
    );

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
          /*
           * Not blocked when the property is absent: applying creates it first
           * and then records the id it was given. `proposedValue` stays null
           * because that id does not exist yet — the plan reports what it
           * knows and never invents an identifier.
           */
          blockedReason: null,
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
      components,
      componentsMissingCount: components.filter(
        (component) => !component.isPresent,
      ).length,
      automaticProperty: {
        name: AUTOMATIC_CUSTOM_PROPERTY_NAME,
        id: automaticPropertyId,
        isPresent: automaticPropertyId !== null,
        willCreate: automaticPropertyId === null,
      },
      routePricedProperties,
      settings,
      missingCount: settings.filter((setting) => !setting.isConfigured).length,
      creatableCount: settings.filter(
        (setting) => !setting.isConfigured && setting.proposedValue !== null,
      ).length,
      /*
       * What an operator must act on, which is now one case only: a setting
       * that EXISTS but has been switched off. The Engine treats it exactly as
       * missing, and reactivating somebody's deliberate decision is not the
       * bootstrap's to make.
       *
       * The automatic property used to be counted here too. It no longer can
       * be: applying creates it.
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
    const before = await this.plan();

    await this.ensureComponents(before);
    await this.ensureAutomaticProperty(before);

    /*
     * Re-planned before the route-priced properties: they link to components
     * the step above may have just created, and the stale plan still reports
     * those as absent.
     */
    const withCatalog = await this.plan();

    await this.ensureRoutePricedProperties(withCatalog);

    /*
     * Re-planned rather than reused: creating the property above produced the
     * id that AUTOMATIC_CUSTOM_PROPERTY_ID must hold, and the stale plan still
     * says it is null. Everything written below comes from THIS reading.
     */
    const current = await this.plan();

    for (const setting of current.settings) {
      if (setting.isConfigured || setting.proposedValue === null) {
        continue;
      }

      await this.settings.upsert(PRICING_CATEGORY, setting.key, {
        value: setting.proposedValue,
      });
    }

    const applied = await this.plan();

    // Keys and counts only. The values are commercial configuration and stay
    // out of the log, exactly as every other settings write does.
    this.logger.log("Pricing configuration bootstrapped", {
      componentsCreated: before.componentsMissingCount,
      automaticPropertyCreated: before.automaticProperty.willCreate,
      routePricedPropertiesCreated: withCatalog.routePricedProperties.filter(
        (property) => property.willCreate,
      ).length,
      settingsCreated: current.creatableCount,
      stillMissing: applied.missingCount,
      blocked: applied.blockedCount,
    });

    return applied;
  }

  /**
   * Creates the catalog rows that are absent, and only those.
   *
   * A component already present is left exactly as it is — including one whose
   * name or description somebody has edited, which is a decision rather than
   * drift, and including one that has been deactivated, which is reported as
   * missing rather than silently reactivated.
   */
  private async ensureComponents(plan: PricingBootstrapPlan): Promise<void> {
    const missing = plan.components.filter((component) => !component.isPresent);

    if (missing.length === 0) {
      return;
    }

    const codes = new Set(missing.map((component) => component.code));

    await this.components.createMany(
      PRICING_COMPONENT_CATALOG.filter((component) =>
        codes.has(component.code),
      ).map((component) => ({
        code: component.code,
        name: component.name,
        description: component.description,
        displayOrder: displayOrderOf(component.code),
      })),
    );

    this.logger.log("Pricing component catalog completed", {
      createdCodes: [...codes],
    });
  }

  /**
   * What each route-priced property looks like now.
   *
   * Presence is decided by NAME among active properties, the same way the
   * automatic property is found — not by "some property links to this
   * component", because that is the question the RouteCost validation asks and
   * answering it here would make the plan agree with itself rather than with
   * the database.
   */
  private async planRoutePricedProperties(
    presentComponentCodes: ReadonlySet<string>,
  ): Promise<RoutePricedPropertyStatus[]> {
    const statuses: RoutePricedPropertyStatus[] = [];

    for (const definition of ROUTE_PRICED_PROPERTY_CATALOG) {
      const existing = await this.customProperties.findActiveByName(
        definition.name,
      );

      /*
       * The component must exist first: a property linking to a component that
       * is not in the catalog cannot be created. Applying creates the catalog
       * before it reaches this step, so this only reports a component somebody
       * has deactivated.
       */
      const componentPresent = presentComponentCodes.has(
        definition.componentCode,
      );

      statuses.push({
        name: definition.name,
        componentCode: definition.componentCode,
        isPresent: existing !== null,
        willCreate: existing === null && componentPresent,
        blockedReason: componentPresent
          ? null
          : `Pricing component "${definition.componentCode}" is not in the catalog, so a property cannot link to it.`,
      });
    }

    return statuses;
  }

  /**
   * Creates the per-Trip switches for the route-priced components.
   *
   * ── WHY THE BOOTSTRAP OWNS THESE ──────────────────────────────────────────
   * Without them a route cannot be configured at all. `RouteCostService`
   * refuses a route cost for a component no property links to, and it is right
   * to: `TollCalculator` charges toll only when a Trip carries a property
   * linked to TOLL, so a route cost without one would be an amount nothing ever
   * reads. Only the DEVELOPMENT seed created them, so every real deployment hit
   *
   *   Pricing component "TOLL" is not route-priced, so it cannot have a route cost
   *
   * the first time an operator typed a Toll amount on the route screen.
   *
   * ── IT CREATES A SWITCH, NOT A CHARGE ─────────────────────────────────────
   * The property carries no default price — a database CHECK forbids it,
   * because the amount is the route's. Creating it prices nothing and assigns
   * nothing: a Trip owes toll only once an operator assigns the property to
   * that Trip, exactly as before.
   */
  private async ensureRoutePricedProperties(
    plan: PricingBootstrapPlan,
  ): Promise<void> {
    for (const property of plan.routePricedProperties) {
      if (!property.willCreate) {
        continue;
      }

      const definition = ROUTE_PRICED_PROPERTY_CATALOG.find(
        (candidate) => candidate.name === property.name,
      );

      const component = await this.components.findActiveByCode(
        property.componentCode,
      );

      if (!definition || !component) {
        continue;
      }

      const created = await this.customProperties.create({
        name: definition.name,
        description: definition.description,
        pricingComponentId: component.id,
      });

      this.logger.log("Route-priced Custom Property created", {
        customPropertyId: created.id,
        name: created.name,
        componentCode: property.componentCode,
      });
    }
  }

  /**
   * Creates the automatic Custom Property when no active one bears its name.
   *
   * ── WHY THE BOOTSTRAP CREATES IT AND NOTHING ELSE DOES ────────────────────
   * Nothing did. `prisma/seed.ts` creates only components, no migration creates
   * it, and `prisma/seed-dev.ts` is development-only fake data that must never
   * reach a real database. So on every fresh deployment the property simply did
   * not exist, `AUTOMATIC_CUSTOM_PROPERTY_ID` could not be resolved, and the
   * Engine refused to price with PRICING_MISSING_SETTING.
   *
   * ── IT IS AN ORDINARY CUSTOM PROPERTY ─────────────────────────────────────
   * Created through the service that owns them, so it obeys the same name
   * uniqueness and ordering rules as one an operator types in, and it is
   * editable and deactivatable afterwards like any other. TAR is not a pricing
   * column, not a table, and not a special case in the Engine — it is a
   * property the configuration happens to point at.
   */
  private async ensureAutomaticProperty(
    plan: PricingBootstrapPlan,
  ): Promise<void> {
    if (!plan.automaticProperty.willCreate) {
      return;
    }

    const created = await this.customProperties.create({
      name: AUTOMATIC_CUSTOM_PROPERTY_NAME,
      description:
        "Applied automatically to every Trip: once on a standalone Trip, and exactly once on the DELIVERY leg of a genuine Combination.",
      defaultPrice: AUTOMATIC_CUSTOM_PROPERTY_DEFAULT_PRICE,
    });

    this.logger.log("Automatic Custom Property created", {
      customPropertyId: created.id,
      name: created.name,
    });
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
