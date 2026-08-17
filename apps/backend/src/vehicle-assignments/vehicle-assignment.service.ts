import { Injectable } from "@nestjs/common";
import { Driver, VehicleAssignment } from "@prisma/client";

import { assignmentInEffect } from "./assignment-period";

import { changedFieldNames } from "../common/changed-fields";
import { addDays, toIsoDate, toUtcDate, todayUtc } from "../common/dates";
import { buildPaginationMeta } from "../common/dto/pagination-meta.dto";
import { DriverService } from "../drivers/driver.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { VehicleService } from "../vehicles/vehicle.service";
import { CreateVehicleAssignmentDto } from "./dto/create-vehicle-assignment.dto";
import { EndVehicleAssignmentDto } from "./dto/end-vehicle-assignment.dto";
import { ListVehicleAssignmentsQueryDto } from "./dto/list-vehicle-assignments-query.dto";
import { UpdateVehicleAssignmentDto } from "./dto/update-vehicle-assignment.dto";
import {
  PaginatedVehicleAssignmentsDto,
  VehicleAssignmentResponseDto,
  toVehicleAssignmentResponse,
} from "./dto/vehicle-assignment-response.dto";
import {
  AssignmentSubject,
  HistoricalAssignmentException,
  InvalidAssignmentPeriodException,
  VehicleAssignmentNotFoundException,
  VehicleAssignmentOverlapException,
} from "./exceptions/vehicle-assignment.exceptions";
import {
  type AssignmentWithDriver,
  VehicleAssignmentRepository,
} from "./vehicle-assignment.repository";

/** One "who drove this vehicle on this day?" question. */
export interface VehicleOnDate {
  readonly vehicleId: string;
  readonly onDate: Date;
}

/**
 * Keys the answer to one such question.
 *
 * Exported so a caller builds the same key it will look up, rather than
 * assuming a format that could change here.
 */
export function assignmentKey(vehicleId: string, onDate: Date): string {
  return `${vehicleId}@${onDate.toISOString().slice(0, 10)}`;
}

@Injectable()
export class VehicleAssignmentService {
  constructor(
    private readonly repository: VehicleAssignmentRepository,
    private readonly vehicleService: VehicleService,
    private readonly driverService: DriverService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(VehicleAssignmentService.name);
  }

  async findAll(
    query: ListVehicleAssignmentsQueryDto,
  ): Promise<PaginatedVehicleAssignmentsDto> {
    const { items, totalItems } = await this.repository.findPage({
      vehicleId: query.vehicleId,
      driverId: query.driverId,
      activeOn: query.activeOnly ? todayUtc() : undefined,
      from: query.from ? toUtcDate(query.from) : undefined,
      to: query.to ? toUtcDate(query.to) : undefined,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });

    return {
      items: items.map(toVehicleAssignmentResponse),
      meta: buildPaginationMeta(totalItems, query.page, query.pageSize),
    };
  }

  async findById(id: string): Promise<VehicleAssignmentResponseDto> {
    return toVehicleAssignmentResponse(await this.requireAssignment(id));
  }

  async findCurrentForVehicle(
    vehicleId: string,
  ): Promise<VehicleAssignmentResponseDto | null> {
    // Delegating existence to VehicleService reuses its lookup and its 404
    // rather than duplicating either here.
    await this.vehicleService.findById(vehicleId);

    const assignment = await this.repository.findCurrentForVehicle(
      vehicleId,
      todayUtc(),
    );

    return assignment ? toVehicleAssignmentResponse(assignment) : null;
  }

  async findCurrentForDriver(
    driverId: string,
  ): Promise<VehicleAssignmentResponseDto | null> {
    await this.driverService.findById(driverId);

    const assignment = await this.repository.findCurrentForDriver(
      driverId,
      todayUtc(),
    );

    return assignment ? toVehicleAssignmentResponse(assignment) : null;
  }

  /**
   * The driver each vehicle was assigned to on a given date.
   *
   * Answers many (vehicle, date) questions with ONE database query, which is
   * what a page of Trips needs: without it, resolving 25 Trips would mean 25
   * lookups. The result is keyed by `assignmentKey` so a caller can ask about
   * the same vehicle on several different dates.
   *
   * A pair with no assignment covering that date is simply absent from the map,
   * which is how "this vehicle had no driver that day" is expressed.
   *
   * An INACTIVE driver is still returned. Deactivating a driver does not
   * retroactively rewrite who drove a Trip last month, and the Trip domain
   * already takes this position: it re-checks active state only when an
   * assignment CHANGES, so a Trip carrying a since-deactivated driver stays
   * valid. The driver's `isActive` flag travels with the answer so a caller can
   * show the state rather than having to infer it.
   */
  async findDriversForVehiclesOnDates(
    requests: readonly VehicleOnDate[],
  ): Promise<Map<string, Driver>> {
    if (requests.length === 0) {
      return new Map();
    }

    const vehicleIds = [...new Set(requests.map((request) => request.vehicleId))];
    const times = requests.map((request) => request.onDate.getTime());

    const assignments = await this.repository.findCoveringVehicles(
      vehicleIds,
      new Date(Math.min(...times)),
      new Date(Math.max(...times)),
    );

    const byVehicle = new Map<string, AssignmentWithDriver[]>();

    for (const assignment of assignments) {
      const existing = byVehicle.get(assignment.vehicleId);

      if (existing) {
        existing.push(assignment);
      } else {
        byVehicle.set(assignment.vehicleId, [assignment]);
      }
    }

    const resolved = new Map<string, Driver>();

    for (const request of requests) {
      const candidates = byVehicle.get(request.vehicleId) ?? [];
      const governing = assignmentInEffect(candidates, request.onDate);

      if (governing) {
        resolved.set(
          assignmentKey(request.vehicleId, request.onDate),
          (governing as AssignmentWithDriver).driver,
        );
      }
    }

    return resolved;
  }

  /**
   * Creates an assignment, auto-closing the superseded open-ended ones.
   *
   * The whole operation runs in one transaction: closing the previous
   * assignment and inserting the new one must both happen or neither, since a
   * partial result would leave two open-ended assignments and violate the
   * database's own unique index.
   */
  async create(
    dto: CreateVehicleAssignmentDto,
  ): Promise<VehicleAssignmentResponseDto> {
    await this.vehicleService.findById(dto.vehicleId);
    await this.driverService.findById(dto.driverId);

    const validFrom = toUtcDate(dto.validFrom);
    const validTo = dto.validTo ? toUtcDate(dto.validTo) : null;

    this.assertPeriodOrdered(validFrom, validTo);

    const created = await this.repository.runInTransaction(
      async (repository) => {
        const supersededIds = dto.validTo
          ? []
          : await this.closeSupersededAssignments(
              repository,
              dto.vehicleId,
              dto.driverId,
              validFrom,
            );

        await this.assertNoOverlap(repository, {
          vehicleId: dto.vehicleId,
          driverId: dto.driverId,
          validFrom,
          validTo,
          ignoreAssignmentIds: supersededIds,
        });

        return repository.create({
          vehicleId: dto.vehicleId,
          driverId: dto.driverId,
          validFrom,
          validTo,
          notes: dto.notes ?? null,
        });
      },
    );

    this.logger.log("Vehicle assignment created", {
      assignmentId: created.id,
      vehicleId: created.vehicleId,
      driverId: created.driverId,
      isOpenEnded: created.validTo === null,
    });

    return toVehicleAssignmentResponse(created);
  }

  async update(
    id: string,
    dto: UpdateVehicleAssignmentDto,
  ): Promise<VehicleAssignmentResponseDto> {
    const assignment = await this.requireAssignment(id);

    if (dto.validTo !== undefined) {
      this.assertNotAlreadyEnded(assignment);

      const validTo = dto.validTo ? toUtcDate(dto.validTo) : null;
      this.assertPeriodOrdered(assignment.validFrom, validTo);

      await this.assertNoOverlap(this.repository, {
        vehicleId: assignment.vehicleId,
        driverId: assignment.driverId,
        validFrom: assignment.validFrom,
        validTo,
        ignoreAssignmentIds: [id],
      });
    }

    const updated = await this.repository.update(id, {
      validTo: dto.validTo === undefined ? undefined : toNullableDate(dto.validTo),
      notes: dto.notes,
    });

    this.logger.log("Vehicle assignment updated", {
      assignmentId: id,
      changedFields: changedFieldNames(dto),
    });

    return toVehicleAssignmentResponse(updated);
  }

  /**
   * Ends an open assignment. Runs in a transaction so the overlap re-check and
   * the write cannot be separated by a concurrent change.
   */
  async end(
    id: string,
    dto: EndVehicleAssignmentDto,
  ): Promise<VehicleAssignmentResponseDto> {
    const assignment = await this.requireAssignment(id);

    this.assertNotAlreadyEnded(assignment);

    const validTo = dto.validTo ? toUtcDate(dto.validTo) : todayUtc();
    this.assertPeriodOrdered(assignment.validFrom, validTo);

    const ended = await this.repository.runInTransaction(async (repository) => {
      await this.assertNoOverlap(repository, {
        vehicleId: assignment.vehicleId,
        driverId: assignment.driverId,
        validFrom: assignment.validFrom,
        validTo,
        ignoreAssignmentIds: [id],
      });

      return repository.setValidTo(id, validTo);
    });

    this.logger.log("Vehicle assignment ended", {
      assignmentId: id,
      vehicleId: assignment.vehicleId,
      driverId: assignment.driverId,
    });

    return toVehicleAssignmentResponse(ended);
  }

  private async requireAssignment(id: string): Promise<VehicleAssignment> {
    const assignment = await this.repository.findById(id);

    if (!assignment) {
      throw new VehicleAssignmentNotFoundException(id);
    }

    return assignment;
  }

  /**
   * Closes the open-ended assignment of the vehicle and of the driver, ending
   * each on the day before the new one starts.
   *
   * Returns the ids that were closed so the subsequent overlap check ignores
   * them: they no longer reach into the new period.
   *
   * An open-ended assignment that starts on or after the new one cannot be
   * closed this way — the end date would precede its own start — so that case
   * is left to the overlap check, which reports it as a genuine conflict.
   */
  private async closeSupersededAssignments(
    repository: VehicleAssignmentRepository,
    vehicleId: string,
    driverId: string,
    validFrom: Date,
  ): Promise<string[]> {
    const candidates = await Promise.all([
      repository.findOpenEndedForVehicle(vehicleId),
      repository.findOpenEndedForDriver(driverId),
    ]);

    const closedIds: string[] = [];
    const dayBefore = addDays(validFrom, -1);

    for (const candidate of candidates) {
      if (!candidate || closedIds.includes(candidate.id)) {
        continue;
      }

      if (candidate.validFrom.getTime() > dayBefore.getTime()) {
        continue;
      }

      await repository.setValidTo(candidate.id, dayBefore);
      closedIds.push(candidate.id);

      this.logger.log("Vehicle assignment automatically closed", {
        assignmentId: candidate.id,
        supersededBy: "new open-ended assignment",
        endedOn: toIsoDate(dayBefore),
      });
    }

    return closedIds;
  }

  /**
   * Checks the vehicle timeline and the driver timeline separately, so the
   * error names which of the two is already occupied.
   */
  private async assertNoOverlap(
    repository: VehicleAssignmentRepository,
    candidate: {
      vehicleId: string;
      driverId: string;
      validFrom: Date;
      validTo: Date | null;
      ignoreAssignmentIds: string[];
    },
  ): Promise<void> {
    const subjects: [AssignmentSubject, { vehicleId?: string; driverId?: string }][] =
      [
        ["vehicle", { vehicleId: candidate.vehicleId }],
        ["driver", { driverId: candidate.driverId }],
      ];

    for (const [subject, filter] of subjects) {
      const conflicts = await repository.findOverlapping({
        ...filter,
        validFrom: candidate.validFrom,
        validTo: candidate.validTo,
      });

      const blocking = conflicts.find(
        (conflict) => !candidate.ignoreAssignmentIds.includes(conflict.id),
      );

      if (blocking) {
        this.logger.warn("Rejected overlapping vehicle assignment", {
          subject,
          conflictingAssignmentId: blocking.id,
        });

        throw new VehicleAssignmentOverlapException(subject, blocking.id);
      }
    }
  }

  private assertPeriodOrdered(validFrom: Date, validTo: Date | null): void {
    if (validTo && validTo.getTime() < validFrom.getTime()) {
      throw new InvalidAssignmentPeriodException(
        toIsoDate(validFrom),
        toIsoDate(validTo),
      );
    }
  }

  /** History is corrected by adding a new assignment, never by re-dating an old one. */
  private assertNotAlreadyEnded(assignment: VehicleAssignment): void {
    const hasEnded =
      assignment.validTo !== null &&
      assignment.validTo.getTime() < todayUtc().getTime();

    if (hasEnded) {
      throw new HistoricalAssignmentException(assignment.id);
    }
  }
}

/** Keeps the undefined/null distinction Prisma relies on for partial updates. */
function toNullableDate(value: string | null): Date | null {
  return value === null ? null : toUtcDate(value);
}
