import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { toIsoDate, toUtcDate, todayUtc } from "../common/dates";
import { buildPaginationMeta } from "../common/dto/pagination-meta.dto";
import { MONEY_DECIMAL_PLACES } from "../common/dto/money";
import { AppLoggerService } from "../logger/app-logger.service";
import { CompleteMaintenanceDto } from "./dto/complete-maintenance.dto";
import { CreateMaintenanceDto } from "./dto/create-maintenance.dto";
import { ListMaintenanceQueryDto } from "./dto/list-maintenance-query.dto";
import { MaintenanceAttentionDto } from "./dto/maintenance-attention.dto";
import {
  MaintenanceDetailDto,
  MaintenanceResponseDto,
  MaintenanceWithHistory,
  PaginatedMaintenanceDto,
  toMaintenanceDetail,
  toMaintenanceResponse,
} from "./dto/maintenance-response.dto";
import { MaintenanceSummaryDto } from "./dto/maintenance-summary.dto";
import { UpdateMaintenanceDto } from "./dto/update-maintenance.dto";
import {
  CompletionInFutureException,
  MaintenanceChangedDuringCompletionException,
  MaintenanceNotCompletableException,
  MaintenanceNotFoundException,
  UnknownMaintenanceVehicleException,
} from "./exceptions/maintenance.exceptions";
import { MaintenanceRepository } from "./maintenance.repository";
import { COMPLETABLE_STATUSES } from "./maintenance-urgency";

/** Enough to act on this morning; the full list is one click away. */
export const ATTENTION_LIMIT = 5;

/**
 * Maintenance administration.
 *
 * ── WHAT THIS SERVICE DOES NOT KNOW ─────────────────────────────────────────
 * A vehicle's CURRENT mileage. There is no odometer in this system, no
 * telematics and no mileage history: `mileage` is what the Administrator typed
 * for a particular job, and `nextMaintenanceMileage` is what they plan for the
 * next one. Neither may be treated as "where the truck is now", and neither
 * decides whether maintenance is late — see `maintenance-urgency.ts`.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * ── ONE RECORD PER MAINTENANCE CYCLE ────────────────────────────────────────
 * Completing a record does not close it and does not create the next one: the
 * same record is planned again and returns to PLANNED, and the cycle that ended
 * goes into its append-only history. See `complete`.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Monetary values are never added here. The total on a summary is summed by the
 * database and rendered from a Decimal, because adding NUMERIC(12,2) amounts as
 * JavaScript numbers would put binary rounding into a figure someone reads as
 * money.
 *
 * Business values — costs, descriptions, workshops, notes — are never written
 * to the log. Only identifiers, statuses, dates and field names are.
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
    const today = todayUtc();
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
      dueOn: query.dueOnly ? today : undefined,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });

    return {
      items: items.map((item) => toMaintenanceResponse(item, today)),
      meta: buildPaginationMeta(totalItems, query.page, query.pageSize),
    };
  }

  /** One record with its full history. */
  async findById(id: string): Promise<MaintenanceDetailDto> {
    return toMaintenanceDetail(await this.requireMaintenance(id), todayUtc());
  }

  /**
   * What the Dashboard shows: the outstanding maintenance most in need of
   * attention. The database selects, orders and limits; see
   * `MaintenanceRepository.findAttention`.
   */
  async findAttention(): Promise<MaintenanceAttentionDto> {
    const today = todayUtc();
    const items = await this.repository.findAttention(ATTENTION_LIMIT);

    return {
      today: toIsoDate(today),
      items: items.map((item) => toMaintenanceResponse(item, today)),
    };
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

    return toMaintenanceResponse(created, todayUtc());
  }

  /**
   * Partial update.
   *
   * The Vehicle is absent from the payload on purpose: the documented rule is
   * that a maintenance record is never reassigned to another asset, and moving
   * one would rewrite the history of two vehicles at once.
   *
   * The history is not touched. A completed cycle is a record of what was
   * done, and editing the record prepares the NEXT cycle.
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

    return toMaintenanceResponse(updated, todayUtc());
  }

  /**
   * Completes the current cycle and plans the same record again.
   *
   * ── WHAT HAPPENS ────────────────────────────────────────────────────────
   * The cycle that ends is appended to the record's history — the date it was
   * planned for, the day it was done, the extra information and the chosen
   * next date — and the SAME record moves to that next date as PLANNED. No
   * second record exists at any moment, so there is never more than one
   * current planning for the cycle.
   *
   * ── WHAT IS REFUSED ─────────────────────────────────────────────────────
   * A COMPLETED or CANCELLED record has no open cycle (409). A completion date
   * in the future is not a completion (400). A request naming a planned date
   * the record no longer has — a double submit, a second open tab — refers to a
   * cycle that is already completed (409). A record that changed after it was
   * read is not completed on stale data (409).
   *
   * The next date may be any day, today and the past included: it is the
   * Administrator's planning, and the urgency rule shows what it means.
   */
  async complete(
    id: string,
    dto: CompleteMaintenanceDto,
  ): Promise<MaintenanceDetailDto> {
    const record = await this.requireMaintenance(id);

    if (!COMPLETABLE_STATUSES.includes(record.status)) {
      throw new MaintenanceNotCompletableException(id, record.status);
    }

    const today = todayUtc();
    const completedOn = dto.completedOn ? toUtcDate(dto.completedOn) : today;

    if (completedOn.getTime() > today.getTime()) {
      throw new CompletionInFutureException(toIsoDate(completedOn));
    }

    const plannedDate = toUtcDate(dto.plannedDate);

    // Without this, a second identical request would find the record PLANNED on
    // its new date and complete that cycle too: one service visit, recorded twice.
    if (plannedDate.getTime() !== record.maintenanceDate.getTime()) {
      this.logger.warn("Maintenance completion names a cycle the record no longer has", {
        maintenanceId: id,
        requestedPlannedDate: toIsoDate(plannedDate),
        currentPlannedDate: toIsoDate(record.maintenanceDate),
      });

      throw new MaintenanceChangedDuringCompletionException(id);
    }

    const nextMaintenanceDate = toUtcDate(dto.nextMaintenanceDate);
    const completed = await this.repository.complete({
      id,
      expectedPlannedDate: plannedDate,
      completedOn,
      nextMaintenanceDate,
      notes: dto.notes ?? null,
      maintenanceType: record.maintenanceType,
      description: record.description,
    });

    if (!completed) {
      this.logger.warn("Maintenance changed while it was being completed", {
        maintenanceId: id,
      });

      throw new MaintenanceChangedDuringCompletionException(id);
    }

    this.logger.log("Maintenance completed and planned again", {
      maintenanceId: id,
      vehicleId: record.vehicleId,
      previousStatus: record.status,
      plannedDate: toIsoDate(record.maintenanceDate),
      completedOn: toIsoDate(completedOn),
      nextMaintenanceDate: toIsoDate(nextMaintenanceDate),
      completionCount: completed.completions.length,
    });

    return toMaintenanceDetail(completed, today);
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

    const today = todayUtc();
    const nextDate = nextPlanned?.nextMaintenanceDate ?? null;

    return {
      vehicleId,
      maintenanceCount: totals.maintenanceCount,
      // Summed by the database; rendered, never recomputed.
      totalCost: (totals.totalCost ?? new Prisma.Decimal(0)).toFixed(
        MONEY_DECIMAL_PLACES,
      ),
      latestMaintenance: latest ? toMaintenanceResponse(latest, today) : null,
      latestMileage: latestWithMileage?.mileage ?? null,
      nextMaintenanceDate: nextDate ? toIsoDate(nextDate) : null,
      nextMaintenanceMileage: nextPlanned?.nextMaintenanceMileage ?? null,
      // Date only. Whether a planned MILEAGE has been reached cannot be
      // answered without a current odometer reading, which does not exist.
      isDueByDate: nextDate !== null && nextDate <= today,
    };
  }

  private async requireMaintenance(id: string): Promise<MaintenanceWithHistory> {
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
}

function toNullableDecimal(value: number | null | undefined): Prisma.Decimal | null {
  return value === null || value === undefined ? null : new Prisma.Decimal(value);
}

function toNullableDate(value: string | null | undefined): Date | null {
  return value === null || value === undefined ? null : toUtcDate(value);
}
