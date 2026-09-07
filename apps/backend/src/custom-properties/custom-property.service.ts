import { Injectable } from "@nestjs/common";
import { CustomProperty, Prisma } from "@prisma/client";

import { changedFieldNames } from "../common/changed-fields";
import { buildPaginationMeta } from "../common/dto/pagination-meta.dto";
import { AppLoggerService } from "../logger/app-logger.service";
import { CustomPropertyRepository } from "./custom-property.repository";
import { CreateCustomPropertyDto } from "./dto/create-custom-property.dto";
import {
  CustomPropertyResponseDto,
  PaginatedCustomPropertiesDto,
  toCustomPropertyResponse,
} from "./dto/custom-property-response.dto";
import { ListCustomPropertiesQueryDto } from "./dto/list-custom-properties-query.dto";
import { UpdateCustomPropertyDto } from "./dto/update-custom-property.dto";
import {
  CustomPropertyHasPricingHistoryException,
  CustomPropertyInUseException,
  CustomPropertyNotFoundException,
  DuplicateComponentLinkException,
  DuplicateCustomPropertyNameException,
  LinkedPropertyMustHaveNoPriceException,
  SystemManagedCustomPropertyDeletionException,
  UnknownPricingComponentException,
} from "./exceptions/custom-property.exceptions";
import {
  SYSTEM_MANAGED_EXPLANATION,
  systemManagedReasonFor,
} from "./system-managed-property";

/** Prisma's unique-constraint violation code. */
const PRISMA_UNIQUE_VIOLATION = "P2002";

/** Position given to the very first property, when the table is empty. */
const FIRST_DISPLAY_ORDER = 1;

/**
 * Stores configurable Trip properties. It never calculates anything — the
 * configured amount is read later by the Pricing Engine.
 *
 * Deactivating RETAINS the record, so historical Trips keep resolving the
 * properties they were assigned. `remove` is the other option: it physically
 * deletes the row, and refuses whenever anything still depends on it.
 */
@Injectable()
export class CustomPropertyService {
  constructor(
    private readonly repository: CustomPropertyRepository,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(CustomPropertyService.name);
  }

  async findAll(
    query: ListCustomPropertiesQueryDto,
  ): Promise<PaginatedCustomPropertiesDto> {
    const { items, totalItems } = await this.repository.findPage({
      isActive: query.isActive,
      search: query.search,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });

    return {
      items: items.map(toCustomPropertyResponse),
      meta: buildPaginationMeta(totalItems, query.page, query.pageSize),
    };
  }

  async findById(id: string): Promise<CustomPropertyResponseDto> {
    return toCustomPropertyResponse(await this.requireCustomProperty(id));
  }

  /**
   * The ACTIVE property configured under this name, or null.
   *
   * Exists so a domain rule can name the property it needs — "Flat" — without
   * carrying a copy of its id. The name is unique among active properties
   * (`custom_property_name_active_key`), so at most one row can answer.
   *
   * Null is an ordinary answer, not an error: a property may have been renamed
   * or deactivated, and what that means is the caller's decision rather than
   * this module's. Deactivated properties are deliberately excluded — an
   * inactive property may not be assigned to anything.
   */
  async findActiveByName(
    name: string,
  ): Promise<CustomPropertyResponseDto | null> {
    const property = await this.repository.findActiveByName(name);

    return property ? toCustomPropertyResponse(property) : null;
  }

  /**
   * Creates a property, appending it to the end of the list when no position is
   * given.
   *
   * Deriving the next position is a read followed by a write, so both run in one
   * transaction — otherwise two concurrent creates could read the same highest
   * order and land on the same position.
   */
  async create(
    dto: CreateCustomPropertyDto,
  ): Promise<CustomPropertyResponseDto> {
    // New properties are always active, so any existing active holder of the
    // name is a conflict.
    await this.assertNameAvailable(dto.name);

    const pricingComponentId = dto.pricingComponentId ?? null;

    await this.assertComponentLinkUsable(
      pricingComponentId,
      dto.defaultPrice ?? null,
    );

    const created = await this.runGuardingUniqueness(
      dto.name,
      pricingComponentId,
      () =>
        this.repository.runInTransaction(async (repository) => {
          const displayOrder =
            dto.displayOrder ?? (await this.nextDisplayOrder(repository));

          return repository.create({
            name: dto.name,
            description: dto.description ?? null,
            pricingComponentId,
            defaultPrice: dto.defaultPrice ?? null,
            displayOrder,
            color: dto.color ?? null,
          });
        }),
    );

    // Business values are never logged — the name, price and description are
    // commercial configuration.
    this.logger.log("Custom property created", {
      customPropertyId: created.id,
    });

    return toCustomPropertyResponse(created);
  }

  async update(
    id: string,
    dto: UpdateCustomPropertyDto,
  ): Promise<CustomPropertyResponseDto> {
    const existing = await this.requireCustomProperty(id);

    const name = dto.name ?? existing.name;
    const nameChanged = name !== existing.name;

    // Only re-check when the name actually changes, and only while the property
    // is active — an inactive row cannot collide with the active-only index.
    if (nameChanged && existing.isActive) {
      await this.assertNameAvailable(name, id);
    }

    // Both rules read the values the row will HOLD after the update, not the
    // ones the request happens to mention: linking a component to a property
    // that already carries a price must fail just as surely as adding a price
    // to a property that is already linked.
    const pricingComponentId =
      dto.pricingComponentId === undefined
        ? existing.pricingComponentId
        : dto.pricingComponentId;
    const defaultPrice =
      dto.defaultPrice === undefined
        ? toNullableNumber(existing.defaultPrice)
        : dto.defaultPrice;

    await this.assertComponentLinkUsable(
      pricingComponentId,
      defaultPrice,
      id,
      // The link is only contested when it moves, or when an inactive property
      // is being edited into a component that may since have been taken.
      pricingComponentId !== existing.pricingComponentId && existing.isActive,
    );

    const updated = await this.runGuardingUniqueness(
      name,
      pricingComponentId,
      () => this.repository.update(id, this.toUpdateData(dto)),
    );

    this.logger.log("Custom property updated", {
      customPropertyId: id,
      changedFields: changedFieldNames(dto),
    });

    return toCustomPropertyResponse(updated);
  }

  /**
   * Reactivating can resurrect a clash: the property kept its name while
   * inactive, but another property may have taken it in the meantime.
   */
  async activate(id: string): Promise<CustomPropertyResponseDto> {
    const property = await this.requireCustomProperty(id);

    if (property.isActive) {
      return toCustomPropertyResponse(property);
    }

    await this.assertNameAvailable(property.name, id);

    // Reactivating can resurrect a second clash: another property may have
    // taken this one's component while it was inactive.
    if (property.pricingComponentId !== null) {
      await this.assertComponentLinkFree(property.pricingComponentId, id);
    }

    const activated = await this.runGuardingUniqueness(
      property.name,
      property.pricingComponentId,
      () => this.repository.setActive(id, true),
    );

    this.logger.log("Custom property activated", { customPropertyId: id });

    return toCustomPropertyResponse(activated);
  }

  /**
   * Soft delete. The record is never removed, so Trips that already carry this
   * property keep resolving it and their frozen pricing stays explainable.
   */
  async deactivate(id: string): Promise<CustomPropertyResponseDto> {
    const property = await this.requireCustomProperty(id);

    if (!property.isActive) {
      return toCustomPropertyResponse(property);
    }

    const deactivated = await this.repository.setActive(id, false);

    this.logger.log("Custom property deactivated", { customPropertyId: id });

    return toCustomPropertyResponse(deactivated);
  }

  /**
   * PHYSICALLY deletes the property. The row leaves the database.
   *
   * ── WHY THIS IS NOT THE DEFAULT WAY TO GET RID OF ONE ───────────────────────
   * `deactivate` remains the ordinary answer: it keeps every Trip and every
   * frozen pricing line explainable. This exists for the case deactivating does
   * not cover — a property created by mistake, or one that was never used —
   * where leaving a row nobody wants in a picker's history is simply clutter.
   *
   * ── EVERY REFUSAL BELOW IS A REAL REFERENCE, NOT A POLICY ──────────────────
   * Exactly two foreign keys point at `custom_property`, and BOTH are ON DELETE
   * RESTRICT, so the database would refuse anyway. Checking first turns a raw
   * P2003 into a sentence that says which dependency stands in the way and how
   * many of them there are.
   *
   * The checks and the delete run in ONE transaction, so an assignment or a
   * pricing line created between the count and the delete cannot slip through —
   * and if one somehow did, RESTRICT still stops it and the transaction rolls
   * back whole. There is no state in which a property is half-removed.
   *
   * ── WHAT IS DELIBERATELY NOT DONE ──────────────────────────────────────────
   * Nothing is cleaned up on the way. Assignments are not withdrawn, pricing
   * lines are not unlinked, and no Trip is repriced. Each of those would change
   * what real Trips are worth as a side effect of tidying a settings page.
   */
  async remove(id: string): Promise<CustomPropertyResponseDto> {
    const deleted = await this.repository.runInTransaction(
      async (repository) => {
        const property = await repository.findById(id);

        if (!property) {
          // Also the answer to a second delete of the same property, which is
          // what a double-clicked button produces.
          throw new CustomPropertyNotFoundException(id);
        }

        this.assertNotSystemManaged(property);
        await this.assertUnused(repository, property);

        return repository.delete(id);
      },
    );

    this.logger.log("Custom property deleted", {
      customPropertyId: id,
      name: deleted.name,
    });

    return toCustomPropertyResponse(deleted);
  }

  /**
   * A property the system owns is not the operator's to delete.
   *
   * ── THIS EXTENDS AN EXISTING CLASSIFICATION TO A NEW BOUNDARY ──────────────
   * `systemManagedReasonFor` was written to stop a MANUAL ASSIGNMENT, and its
   * call site says so outright. It protected no row, because until now no row
   * could be deleted. The classification is reused rather than restated so the
   * two boundaries cannot drift, and each of its three reasons is independently
   * fatal to a delete:
   *
   *   ROUTE_PRICED       Toll and Tunnel are how route_cost reaches its pricing
   *                      component. Delete one and the route configuration
   *                      still holds costs that nothing applies any more.
   *   AUTOMATIC_PRICING  TAR is what the `AUTOMATIC_CUSTOM_PROPERTY_ID` setting
   *                      points at — as TEXT, with no foreign key, so the
   *                      database would not stop this and the setting would be
   *                      left pointing at nothing.
   *   CONTAINER_TYPE     Flat is resolved BY NAME by the container-type rule,
   *                      again with nothing in the database to protect it.
   *
   * Two of the three are invisible to the schema, which is exactly why this
   * check cannot be left to the foreign keys.
   */
  private assertNotSystemManaged(property: CustomProperty): void {
    const reason = systemManagedReasonFor(property);

    if (reason === null) {
      return;
    }

    this.logger.warn("Rejected deletion of a system-managed custom property", {
      customPropertyId: property.id,
      reason,
    });

    throw new SystemManagedCustomPropertyDeletionException(
      property.name,
      SYSTEM_MANAGED_EXPLANATION[reason],
    );
  }

  /**
   * Refuses while anything still points at the property.
   *
   * Assignments are reported first because they are the fixable one: an
   * operator can withdraw them. Pricing history is not fixable and not meant to
   * be — those lines are what Trips were charged.
   */
  private async assertUnused(
    repository: CustomPropertyRepository,
    property: CustomProperty,
  ): Promise<void> {
    const assignments = await repository.countAssignments(property.id);

    if (assignments > 0) {
      this.logger.warn("Rejected deletion of a custom property still in use", {
        customPropertyId: property.id,
        assignments,
      });

      throw new CustomPropertyInUseException(property.name, assignments);
    }

    const pricingItems = await repository.countPricingItems(property.id);

    if (pricingItems > 0) {
      this.logger.warn("Rejected deletion of a priced-in-history property", {
        customPropertyId: property.id,
        pricingItems,
      });

      throw new CustomPropertyHasPricingHistoryException(
        property.name,
        pricingItems,
      );
    }
  }

  private async requireCustomProperty(id: string): Promise<CustomProperty> {
    const property = await this.repository.findById(id);

    if (!property) {
      throw new CustomPropertyNotFoundException(id);
    }

    return property;
  }

  private async nextDisplayOrder(
    repository: CustomPropertyRepository,
  ): Promise<number> {
    const highest = await repository.findHighestDisplayOrder();

    return highest === null ? FIRST_DISPLAY_ORDER : highest + 1;
  }

  private async assertNameAvailable(
    name: string,
    excludeCustomPropertyId?: string,
  ): Promise<void> {
    const holder = await this.repository.findActiveByName(
      name,
      excludeCustomPropertyId,
    );

    if (holder) {
      this.logger.warn("Rejected duplicate custom property name", {
        customPropertyId: excludeCustomPropertyId,
        conflictingCustomPropertyId: holder.id,
      });

      throw new DuplicateCustomPropertyNameException(name);
    }
  }

  /**
   * The check above is a courtesy that produces a good error message; it cannot
   * be atomic. The partial unique index is the real guard, so its violation is
   * translated here rather than escaping as a raw Prisma error.
   */
  /**
   * Rejects a component link that cannot be used.
   *
   * Two rules, both from database_model.md §4.12 and both also enforced by the
   * database: a linked property carries no price of its own, and a component is
   * reachable through at most one active property.
   */
  private async assertComponentLinkUsable(
    pricingComponentId: string | null,
    defaultPrice: number | null,
    excludeCustomPropertyId?: string,
    checkAvailability = true,
  ): Promise<void> {
    if (pricingComponentId === null) {
      return;
    }

    if (defaultPrice !== null) {
      this.logger.warn("Rejected a priced custom property with a component", {
        pricingComponentId,
      });

      throw new LinkedPropertyMustHaveNoPriceException(pricingComponentId);
    }

    if (!(await this.repository.pricingComponentExists(pricingComponentId))) {
      throw new UnknownPricingComponentException(pricingComponentId);
    }

    if (checkAvailability) {
      await this.assertComponentLinkFree(
        pricingComponentId,
        excludeCustomPropertyId,
      );
    }
  }

  private async assertComponentLinkFree(
    pricingComponentId: string,
    excludeCustomPropertyId?: string,
  ): Promise<void> {
    const holder = await this.repository.findActiveByPricingComponent(
      pricingComponentId,
      excludeCustomPropertyId,
    );

    if (holder) {
      this.logger.warn("Rejected duplicate pricing component link", {
        pricingComponentId,
        conflictingCustomPropertyId: holder.id,
      });

      throw new DuplicateComponentLinkException(pricingComponentId);
    }
  }

  /**
   * Translates a unique-index violation into the right domain exception.
   *
   * Two partial unique indexes can fire here — one on the name, one on the
   * component link — so the index named in the error decides which conflict is
   * reported. Guessing would tell an administrator the name is taken when in
   * fact the component is.
   */
  private async runGuardingUniqueness<TResult>(
    name: string,
    pricingComponentId: string | null,
    operation: () => Promise<TResult>,
  ): Promise<TResult> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PRISMA_UNIQUE_VIOLATION
      ) {
        if (pricingComponentId !== null && violatedComponentIndex(error)) {
          throw new DuplicateComponentLinkException(pricingComponentId);
        }

        throw new DuplicateCustomPropertyNameException(name);
      }

      throw error;
    }
  }

  /**
   * Passes the DTO through unchanged: Prisma treats `undefined` as "leave
   * alone" and `null` as "set to null", which is exactly PATCH semantics.
   */
  private toUpdateData(
    dto: UpdateCustomPropertyDto,
  ): Prisma.CustomPropertyUncheckedUpdateInput {
    return {
      name: dto.name,
      description: dto.description,
      pricingComponentId: dto.pricingComponentId,
      defaultPrice: dto.defaultPrice,
      displayOrder: dto.displayOrder,
      color: dto.color,
    };
  }
}

/** Prisma returns money as a Decimal; the rules compare plain numbers. */
function toNullableNumber(value: Prisma.Decimal | null): number | null {
  return value === null ? null : Number(value);
}

/** True when the failing index is the one on the component link. */
function violatedComponentIndex(
  error: Prisma.PrismaClientKnownRequestError,
): boolean {
  const target = error.meta?.target;
  const named = Array.isArray(target) ? target.join(",") : String(target ?? "");

  return named.includes("pricing_component");
}
