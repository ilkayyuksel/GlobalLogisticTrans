import { Injectable } from "@nestjs/common";
import { Prisma, Vehicle } from "@prisma/client";

import { buildPaginationMeta } from "../common/dto/pagination-meta.dto";
import { AppLoggerService } from "../logger/app-logger.service";
import { CreateVehicleDto } from "./dto/create-vehicle.dto";
import { ListVehiclesQueryDto } from "./dto/list-vehicles-query.dto";
import { UpdateVehicleDto } from "./dto/update-vehicle.dto";
import {
  PaginatedVehiclesDto,
  VehicleResponseDto,
  toVehicleResponse,
} from "./dto/vehicle-response.dto";
import {
  VehicleDisplayColorConflictException,
  VehicleLicensePlateConflictException,
  VehicleNotFoundException,
} from "./exceptions/vehicle.exceptions";
import { VehicleRepository } from "./vehicle.repository";

/** Prisma's unique-constraint violation code. */
const PRISMA_UNIQUE_VIOLATION = "P2002";

@Injectable()
export class VehicleService {
  constructor(
    private readonly repository: VehicleRepository,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(VehicleService.name);
  }

  async findAll(query: ListVehiclesQueryDto): Promise<PaginatedVehiclesDto> {
    const { items, totalItems } = await this.repository.findPage({
      isActive: query.isActive,
      search: query.search,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });

    return {
      items: items.map(toVehicleResponse),
      meta: buildPaginationMeta(totalItems, query.page, query.pageSize),
    };
  }

  async findById(id: string): Promise<VehicleResponseDto> {
    return toVehicleResponse(await this.requireVehicle(id));
  }

  /**
   * Several Vehicles by id, as records rather than responses.
   *
   * Returns the Prisma rows so a caller can build whatever shape it needs — a
   * summary embedded in another response, for instance — without this service
   * guessing at that shape. Missing ids are simply absent from the map, because
   * a batch lookup has no single subject to raise a 404 about.
   *
   * Exists to keep list endpoints off the N+1 path.
   */
  async findManyByIds(ids: readonly string[]): Promise<Map<string, Vehicle>> {
    const found = await this.repository.findManyByIds(ids);

    return new Map(found.map((record) => [record.id, record]));
  }

  async create(dto: CreateVehicleDto): Promise<VehicleResponseDto> {
    // New vehicles are always active, so any existing active holder of either
    // identifier is a conflict.
    await this.assertLicensePlateAvailable(dto.licensePlate);
    await this.assertDisplayColorAvailable(dto.displayColor);

    const vehicle = await this.runGuardingLicensePlate(dto.licensePlate, () =>
      this.repository.create({
        licensePlate: dto.licensePlate,
        displayColor: dto.displayColor,
        description: dto.description ?? null,
        brand: dto.brand ?? null,
        model: dto.model ?? null,
        year: dto.year ?? null,
        notes: dto.notes ?? null,
      }),
    );

    this.logger.log("Vehicle created", { vehicleId: vehicle.id });

    return toVehicleResponse(vehicle);
  }

  async update(id: string, dto: UpdateVehicleDto): Promise<VehicleResponseDto> {
    await this.requireVehicle(id);

    // Only re-check when the value actually changes, so saving an unchanged
    // vehicle never trips over its own identifiers.
    if (dto.licensePlate !== undefined) {
      await this.assertLicensePlateAvailable(dto.licensePlate, id);
    }

    if (dto.displayColor !== undefined) {
      await this.assertDisplayColorAvailable(dto.displayColor, id);
    }

    const updated = await this.runGuardingLicensePlate(
      dto.licensePlate,
      () => this.repository.update(id, this.toUpdateData(dto)),
    );

    this.logger.log("Vehicle updated", {
      vehicleId: id,
      changedFields: this.changedFieldNames(dto),
    });

    return toVehicleResponse(updated);
  }

  /**
   * Reactivating can resurrect a clash: the vehicle kept its plate and colour
   * while inactive, but another active vehicle may have taken either meanwhile.
   */
  async activate(id: string): Promise<VehicleResponseDto> {
    const vehicle = await this.requireVehicle(id);

    if (vehicle.isActive) {
      return toVehicleResponse(vehicle);
    }

    await this.assertLicensePlateAvailable(vehicle.licensePlate, id);
    await this.assertDisplayColorAvailable(vehicle.displayColor, id);

    const activated = await this.runGuardingLicensePlate(
      vehicle.licensePlate,
      () => this.repository.setActive(id, true),
    );

    this.logger.log("Vehicle activated", { vehicleId: id });

    return toVehicleResponse(activated);
  }

  /**
   * Soft delete. The record is never removed, so historical Trips keep
   * resolving their vehicle; only new assignments are prevented.
   */
  async deactivate(id: string): Promise<VehicleResponseDto> {
    const vehicle = await this.requireVehicle(id);

    if (!vehicle.isActive) {
      return toVehicleResponse(vehicle);
    }

    const deactivated = await this.repository.setActive(id, false);

    this.logger.log("Vehicle deactivated", { vehicleId: id });

    return toVehicleResponse(deactivated);
  }

  private async requireVehicle(id: string): Promise<Vehicle> {
    const vehicle = await this.repository.findById(id);

    if (!vehicle) {
      throw new VehicleNotFoundException(id);
    }

    return vehicle;
  }

  private async assertLicensePlateAvailable(
    licensePlate: string,
    excludeVehicleId?: string,
  ): Promise<void> {
    const holder = await this.repository.findActiveByLicensePlate(
      licensePlate,
      excludeVehicleId,
    );

    if (holder) {
      throw new VehicleLicensePlateConflictException(licensePlate);
    }
  }

  /**
   * Colour uniqueness is enforced here only — there is no database index for it
   * (database_schema.md §6.1 defines display_color as not unique). It is
   * therefore best-effort: a concurrent create can still produce a duplicate,
   * and direct SQL or a seed bypasses it entirely.
   */
  private async assertDisplayColorAvailable(
    displayColor: string,
    excludeVehicleId?: string,
  ): Promise<void> {
    const holder = await this.repository.findActiveByDisplayColor(
      displayColor,
      excludeVehicleId,
    );

    if (holder) {
      throw new VehicleDisplayColorConflictException(displayColor);
    }
  }

  /**
   * The plate check above is a courtesy that produces a good error message; it
   * cannot be atomic. The partial unique index is the real guard, so its
   * violation is translated here rather than escaping as a raw Prisma error.
   */
  private async runGuardingLicensePlate<TResult>(
    licensePlate: string | undefined,
    operation: () => Promise<TResult>,
  ): Promise<TResult> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (
        licensePlate &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PRISMA_UNIQUE_VIOLATION
      ) {
        throw new VehicleLicensePlateConflictException(licensePlate);
      }

      throw error;
    }
  }

  /**
   * Passes the DTO through unchanged: Prisma treats `undefined` as "leave
   * alone" and `null` as "set to null", which is exactly PATCH semantics.
   */
  private toUpdateData(
    dto: UpdateVehicleDto,
  ): Prisma.VehicleUncheckedUpdateInput {
    return {
      licensePlate: dto.licensePlate,
      displayColor: dto.displayColor,
      description: dto.description,
      brand: dto.brand,
      model: dto.model,
      year: dto.year,
      notes: dto.notes,
    };
  }

  private changedFieldNames(dto: UpdateVehicleDto): string[] {
    return Object.entries(dto)
      .filter(([, value]) => value !== undefined)
      .map(([field]) => field);
  }
}
