import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { toIsoDate, toUtcDate } from "../common/dates";
import { buildPaginationMeta } from "../common/dto/pagination-meta.dto";
import { MONEY_DECIMAL_PLACES } from "../common/dto/money";
import { AppLoggerService } from "../logger/app-logger.service";
import { CreateMaintenanceDto } from "./dto/create-maintenance.dto";
import { ListMaintenanceQueryDto } from "./dto/list-maintenance-query.dto";
import {
  MaintenanceResponseDto,
  MaintenanceWithVehicle,
  PaginatedMaintenanceDto,
  toMaintenanceResponse,
} from "./dto/maintenance-response.dto";
import { MaintenanceSummaryDto } from "./dto/maintenance-summary.dto";
import { UpdateMaintenanceDto } from "./dto/update-maintenance.dto";
import {
  MaintenanceNotFoundException,
  UnknownMaintenanceVehicleException,
} from "./exceptions/maintenance.exceptions";
import { MaintenanceRepository } from "./maintenance.repository";

/**
 * Maintenance administration.
 *
 * ── WHAT THIS SERVICE DOES NOT KNOW ─────────────────────────────────────────
 * A vehicle's CURRENT mileage. There is no odometer in this system, no
 * telematics and no mileage history: `mileage` is what the Administrator typed
 * for a particular job, and `nextMaintenanceMileage` is what they plan for the
 * next one. Neither may be treated as "where the truck is now".
 *
 * That is why "due" here means one thing only: a planned next DATE has arrived.
 * A mileage-based due date is not evaluable, and this service says so by never
 * pretending otherwise — `isDueByDate` is named for exactly what it decides.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Monetary values are never added here. The total on a summary is summed by the
 * database and rendered from a Decimal, because adding NUMERIC(12,2) amounts as
 * JavaScript numbers would put binary rounding into a figure someone reads as
 * money.
 *
 * Business values — costs, descriptions, workshops — are never written to the
 * log. Only identifiers and field names are.
 */
@Injectable()
export class MaintenanceService {
  constructor(
    private readonly repository: MaintenanceRepository,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(MaintenanceService.name);
  }

  async findAll(
    query: ListMaintenanceQueryDto,
  ): Promise<PaginatedMaintenanceDto> {
    const { items, totalItems } = await this.repository.findPage({
      vehicleId: query.vehicleId,
      status: query.status,
      maintenanceDateFrom: query.maintenanceDateFrom
        ? toUtcDate(query.maintenanceDateFrom)
        : undefined,
      maintenanceDateTo: query.maintenanceDateTo
        ? toUtcDate(query.maintenanceDateTo)
        : undefined,
      search: query.search,
      dueOn: query.dueOnly ? this.today() : undefined,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });

    return {
      items: items.map(toMaintenanceResponse),
      meta: buildPaginationMeta(totalItems, query.page, query.pageSize),
    };
  }

  async findById(id: string): Promise<MaintenanceResponseDto> {
    return toMaintenanceResponse(await this.requireMaintenance(id));
  }

  async create(dto: CreateMaintenanceDto): Promise<MaintenanceResponseDto> {
    await this.assertVehicleExists(dto.vehicleId);

    const created = await this.repository.create({
      vehicleId: dto.vehicleId,
      status: dto.status,
      maintenanceType: dto.maintenanceType ?? null,
      maintenanceDate: toUtcDate(dto.maintenanceDate),
      description: dto.description,
      mileage: dto.mileage ?? null,
      cost: toNullableDecimal(dto.cost),
      workshop: dto.workshop ?? null,
      nextMaintenanceDate: toNullableDate(dto.nextMaintenanceDate),
      nextMaintenanceMileage: dto.nextMaintenanceMileage ?? null,
      notes: dto.notes ?? null,
    });

    this.logger.log("Maintenance recorded", {
      maintenanceId: created.id,
      vehicleId: created.vehicleId,
      status: created.status,
    });

    return toMaintenanceResponse(created);
  }

  /**
   * Partial update.
   *
   * The Vehicle is absent from the payload on purpose: the documented rule is
   * that a maintenance record is never reassigned to another asset, and moving
   * one would rewrite the history of two vehicles at once.
   */
  async update(
    id: string,
    dto: UpdateMaintenanceDto,
  ): Promise<MaintenanceResponseDto> {
    await this.requireMaintenance(id);

    const updated = await this.repository.update(id, {
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.maintenanceType !== undefined
        ? { maintenanceType: dto.maintenanceType }
        : {}),
      ...(dto.maintenanceDate !== undefined
        ? { maintenanceDate: toUtcDate(dto.maintenanceDate) }
        : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.mileage !== undefined ? { mileage: dto.mileage } : {}),
      ...(dto.cost !== undefined ? { cost: toNullableDecimal(dto.cost) } : {}),
      ...(dto.workshop !== undefined ? { workshop: dto.workshop } : {}),
      ...(dto.nextMaintenanceDate !== undefined
        ? { nextMaintenanceDate: toNullableDate(dto.nextMaintenanceDate) }
        : {}),
      ...(dto.nextMaintenanceMileage !== undefined
        ? { nextMaintenanceMileage: dto.nextMaintenanceMileage }
        : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
    });

    this.logger.log("Maintenance updated", {
      maintenanceId: id,
      status: updated.status,
      changedFields: Object.keys(dto),
    });

    return toMaintenanceResponse(updated);
  }

  /**
   * What one Vehicle's maintenance adds up to.
   *
   * Four small queries rather than one page of rows and a loop: the count and
   * the total are computed by PostgreSQL, and the latest record, the latest
   * recorded mileage and the next planned maintenance are each a single row.
   * None of them grows with the size of the history.
   */
  async summaryForVehicle(vehicleId: string): Promise<MaintenanceSummaryDto> {
    await this.assertVehicleExists(vehicleId);

    const [totals, latest, latestWithMileage, nextPlanned] = await Promise.all([
      this.repository.totalsForVehicle(vehicleId),
      this.repository.findLatestForVehicle(vehicleId),
      this.repository.findLatestWithMileageForVehicle(vehicleId),
      this.repository.findNextPlannedForVehicle(vehicleId),
    ]);

    const nextDate = nextPlanned?.nextMaintenanceDate ?? null;

    return {
      vehicleId,
      maintenanceCount: totals.maintenanceCount,
      // Summed by the database; rendered, never recomputed.
      totalCost: (totals.totalCost ?? new Prisma.Decimal(0)).toFixed(
        MONEY_DECIMAL_PLACES,
      ),
      latestMaintenance: latest ? toMaintenanceResponse(latest) : null,
      latestMileage: latestWithMileage?.mileage ?? null,
      nextMaintenanceDate: nextDate ? toIsoDate(nextDate) : null,
      nextMaintenanceMileage: nextPlanned?.nextMaintenanceMileage ?? null,
      // Date only. Whether a planned MILEAGE has been reached cannot be
      // answered without a current odometer reading, which does not exist.
      isDueByDate: nextDate !== null && nextDate <= this.today(),
    };
  }

  private async requireMaintenance(id: string): Promise<MaintenanceWithVehicle> {
    const maintenance = await this.repository.findById(id);

    if (!maintenance) {
      throw new MaintenanceNotFoundException(id);
    }

    return maintenance;
  }

  private async assertVehicleExists(vehicleId: string): Promise<void> {
    if (!(await this.repository.vehicleExists(vehicleId))) {
      throw new UnknownMaintenanceVehicleException(vehicleId);
    }
  }

  /**
   * Today at UTC midnight, to compare against DATE columns.
   *
   * The columns carry no timezone, so the comparison must not either: using a
   * local moment would make a maintenance fall due a day early or late
   * depending on where the server stands.
   */
  private today(): Date {
    const now = new Date();

    return new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
  }
}

function toNullableDecimal(value: number | null | undefined): Prisma.Decimal | null {
  return value === null || value === undefined ? null : new Prisma.Decimal(value);
}

function toNullableDate(value: string | null | undefined): Date | null {
  return value === null || value === undefined ? null : toUtcDate(value);
}
