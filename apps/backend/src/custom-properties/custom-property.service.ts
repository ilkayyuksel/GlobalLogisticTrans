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
  CustomPropertyNotFoundException,
  DuplicateCustomPropertyNameException,
} from "./exceptions/custom-property.exceptions";

/** Prisma's unique-constraint violation code. */
const PRISMA_UNIQUE_VIOLATION = "P2002";

/** Position given to the very first property, when the table is empty. */
const FIRST_DISPLAY_ORDER = 1;

/**
 * Stores configurable Trip properties. It never calculates anything — the
 * configured amount is read later by the Pricing Engine.
 *
 * Deactivated properties are retained rather than deleted, so historical Trips
 * keep resolving the properties they were assigned.
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

    const created = await this.runGuardingName(dto.name, () =>
      this.repository.runInTransaction(async (repository) => {
        const displayOrder =
          dto.displayOrder ?? (await this.nextDisplayOrder(repository));

        return repository.create({
          name: dto.name,
          description: dto.description ?? null,
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

    const updated = await this.runGuardingName(name, () =>
      this.repository.update(id, this.toUpdateData(dto)),
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

    const activated = await this.runGuardingName(property.name, () =>
      this.repository.setActive(id, true),
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
  private async runGuardingName<TResult>(
    name: string,
    operation: () => Promise<TResult>,
  ): Promise<TResult> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PRISMA_UNIQUE_VIOLATION
      ) {
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
      defaultPrice: dto.defaultPrice,
      displayOrder: dto.displayOrder,
      color: dto.color,
    };
  }
}
