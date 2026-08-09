import { Injectable } from "@nestjs/common";
import { Driver, Prisma } from "@prisma/client";

import { buildPaginationMeta } from "../common/dto/pagination-meta.dto";
import { AppLoggerService } from "../logger/app-logger.service";
import { CreateDriverDto } from "./dto/create-driver.dto";
import {
  DriverResponseDto,
  PaginatedDriversDto,
  toDriverResponse,
} from "./dto/driver-response.dto";
import { ListDriversQueryDto } from "./dto/list-drivers-query.dto";
import { UpdateDriverDto } from "./dto/update-driver.dto";
import {
  DriverLicenceNumberConflictException,
  DriverNotFoundException,
} from "./exceptions/driver.exceptions";
import { DriverRepository } from "./driver.repository";

/** Prisma's unique-constraint violation code. */
const PRISMA_UNIQUE_VIOLATION = "P2002";

@Injectable()
export class DriverService {
  constructor(
    private readonly repository: DriverRepository,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(DriverService.name);
  }

  async findAll(query: ListDriversQueryDto): Promise<PaginatedDriversDto> {
    const { items, totalItems } = await this.repository.findPage({
      isActive: query.isActive,
      search: query.search,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });

    return {
      items: items.map(toDriverResponse),
      meta: buildPaginationMeta(totalItems, query.page, query.pageSize),
    };
  }

  async findById(id: string): Promise<DriverResponseDto> {
    return toDriverResponse(await this.requireDriver(id));
  }

  async create(dto: CreateDriverDto): Promise<DriverResponseDto> {
    // New drivers are always active, so any existing active holder of this
    // licence number is a conflict.
    await this.assertLicenceNumberAvailable(dto.licenceNumber ?? null);

    const driver = await this.runGuardingLicenceNumber(
      dto.licenceNumber ?? null,
      () =>
        this.repository.create({
          name: dto.name,
          licenceNumber: dto.licenceNumber ?? null,
          phoneNumber: dto.phoneNumber ?? null,
          email: dto.email ?? null,
          emergencyContact: dto.emergencyContact ?? null,
          notes: dto.notes ?? null,
        }),
    );

    // Personal data is never logged — only the identifier, which is enough to
    // correlate the event with the record.
    this.logger.log("Driver created", { driverId: driver.id });

    return toDriverResponse(driver);
  }

  async update(id: string, dto: UpdateDriverDto): Promise<DriverResponseDto> {
    const existing = await this.requireDriver(id);

    // Only re-check when the licence number actually changes, so saving an
    // unchanged driver never trips over its own value.
    if (dto.licenceNumber !== undefined && dto.licenceNumber !== null) {
      await this.assertLicenceNumberAvailable(dto.licenceNumber, id);
    }

    const updated = await this.runGuardingLicenceNumber(
      dto.licenceNumber ?? null,
      () => this.repository.update(id, this.toUpdateData(dto)),
    );

    // Field names only: the values may be personal data.
    this.logger.log("Driver updated", {
      driverId: id,
      changedFields: this.changedFieldNames(dto),
      wasActive: existing.isActive,
    });

    return toDriverResponse(updated);
  }

  /**
   * Reactivating can resurrect a licence-number clash: the driver was allowed
   * to keep its number while inactive, but another active driver may have taken
   * it in the meantime.
   */
  async activate(id: string): Promise<DriverResponseDto> {
    const driver = await this.requireDriver(id);

    if (driver.isActive) {
      return toDriverResponse(driver);
    }

    if (driver.licenceNumber) {
      await this.assertLicenceNumberAvailable(driver.licenceNumber, id);
    }

    const activated = await this.runGuardingLicenceNumber(
      driver.licenceNumber,
      () => this.repository.setActive(id, true),
    );

    this.logger.log("Driver activated", { driverId: id });

    return toDriverResponse(activated);
  }

  /**
   * Soft delete. The record is never removed, so historical Trips keep
   * resolving their driver; only new assignments are prevented.
   */
  async deactivate(id: string): Promise<DriverResponseDto> {
    const driver = await this.requireDriver(id);

    if (!driver.isActive) {
      return toDriverResponse(driver);
    }

    const deactivated = await this.repository.setActive(id, false);

    this.logger.log("Driver deactivated", { driverId: id });

    return toDriverResponse(deactivated);
  }

  private async requireDriver(id: string): Promise<Driver> {
    const driver = await this.repository.findById(id);

    if (!driver) {
      throw new DriverNotFoundException(id);
    }

    return driver;
  }

  private async assertLicenceNumberAvailable(
    licenceNumber: string | null,
    excludeDriverId?: string,
  ): Promise<void> {
    if (!licenceNumber) {
      return;
    }

    const holder = await this.repository.findActiveByLicenceNumber(
      licenceNumber,
      excludeDriverId,
    );

    if (holder) {
      throw new DriverLicenceNumberConflictException(licenceNumber);
    }
  }

  /**
   * The check above is a courtesy that produces a good error message; it cannot
   * be atomic. The partial unique index is the real guard, so its violation is
   * translated here rather than escaping as a raw Prisma error.
   */
  private async runGuardingLicenceNumber<TResult>(
    licenceNumber: string | null,
    operation: () => Promise<TResult>,
  ): Promise<TResult> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (
        licenceNumber &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PRISMA_UNIQUE_VIOLATION
      ) {
        throw new DriverLicenceNumberConflictException(licenceNumber);
      }

      throw error;
    }
  }

  /**
   * Passes the DTO through unchanged: Prisma treats `undefined` as "leave
   * alone" and `null` as "set to null", which is exactly PATCH semantics.
   */
  private toUpdateData(dto: UpdateDriverDto): Prisma.DriverUncheckedUpdateInput {
    return {
      name: dto.name,
      licenceNumber: dto.licenceNumber,
      phoneNumber: dto.phoneNumber,
      email: dto.email,
      emergencyContact: dto.emergencyContact,
      notes: dto.notes,
    };
  }

  private changedFieldNames(dto: UpdateDriverDto): string[] {
    return Object.entries(dto)
      .filter(([, value]) => value !== undefined)
      .map(([field]) => field);
  }
}
