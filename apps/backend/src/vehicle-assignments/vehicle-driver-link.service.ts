import { Injectable } from "@nestjs/common";
import { VehicleAssignment } from "@prisma/client";

import { toIsoDate, todayUtc } from "../common/dates";
import { DriverService } from "../drivers/driver.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { VehicleService } from "../vehicles/vehicle.service";
import { translateActiveAssignmentRace } from "./active-assignment-race";
import { cutOffAssignment, isVoidAssignment } from "./assignment-cutoff";
import { LinkVehicleDriverDto } from "./dto/link-vehicle-driver.dto";
import {
  VehicleDriverLinkResponseDto,
  toVehicleDriverLinkResponse,
} from "./dto/vehicle-driver-link-response.dto";
import { VehicleAssignmentRepository } from "./vehicle-assignment.repository";

/**
 * "This truck is now driven by this driver" — the one-step link the
 * management page offers.
 *
 * From today, open-ended. Whatever stands in the way is ended first: the
 * truck's other driver, the driver's other truck, or both — together with any
 * assignment of either that was planned to start later, since an open-ended
 * link would overlap it. Ended rows are kept as history; one that began today
 * is ended before it began (`isVoidAssignment`). Finished Trips that showed an
 * ended driver keep that driver; unfinished ones follow the new driver
 * (`cutOffAssignment`).
 *
 * Everything runs in one transaction, and the database's active-assignment
 * indexes refuse a concurrent link that slipped past the reads
 * (`translateActiveAssignmentRace`).
 */
@Injectable()
export class VehicleDriverLinkService {
  constructor(
    private readonly repository: VehicleAssignmentRepository,
    private readonly vehicleService: VehicleService,
    private readonly driverService: DriverService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(VehicleDriverLinkService.name);
  }

  async link(dto: LinkVehicleDriverDto): Promise<VehicleDriverLinkResponseDto> {
    await this.vehicleService.findById(dto.vehicleId);
    await this.driverService.findById(dto.driverId);

    // Read once, so a link made across midnight agrees with itself.
    const today = todayUtc();

    const result = await translateActiveAssignmentRace(() =>
      this.repository.runInTransaction(async (repository) => {
        const existing = await this.identicalLink(repository, dto, today);

        if (existing) {
          return toVehicleDriverLinkResponse("ALREADY_LINKED", existing, []);
        }

        const ended = await this.endConflicts(repository, dto, today);
        const created = await repository.create({
          vehicleId: dto.vehicleId,
          driverId: dto.driverId,
          validFrom: today,
          validTo: null,
          notes: null,
        });

        return toVehicleDriverLinkResponse("LINKED", created, ended);
      }),
    );

    this.logger.log("Vehicle and driver linked", {
      vehicleId: dto.vehicleId,
      driverId: dto.driverId,
      outcome: result.outcome,
      assignmentId: result.assignment.id,
      endedAssignmentIds: result.endedAssignments.map((ended) => ended.id),
    });

    return result;
  }

  /** The open-ended link of exactly this pair, already in effect today. */
  private async identicalLink(
    repository: VehicleAssignmentRepository,
    dto: LinkVehicleDriverDto,
    today: Date,
  ): Promise<VehicleAssignment | null> {
    const current = await repository.findOpenEndedForVehicle(dto.vehicleId);

    const isIdentical =
      current !== null &&
      current.driverId === dto.driverId &&
      current.validFrom.getTime() <= today.getTime();

    return isIdentical ? current : null;
  }

  /** Every assignment of the truck or the driver that reaches today or later. */
  private async endConflicts(
    repository: VehicleAssignmentRepository,
    dto: LinkVehicleDriverDto,
    today: Date,
  ): Promise<VehicleAssignment[]> {
    const reachingToday = { validFrom: today, validTo: null };
    const [ofVehicle, ofDriver] = await Promise.all([
      repository.findOverlapping({ ...reachingToday, vehicleId: dto.vehicleId }),
      repository.findOverlapping({ ...reachingToday, driverId: dto.driverId }),
    ]);

    const conflicts = new Map<string, VehicleAssignment>();

    for (const conflict of [...ofVehicle, ...ofDriver]) {
      if (!isVoidAssignment(conflict)) {
        conflicts.set(conflict.id, conflict);
      }
    }

    const ended: VehicleAssignment[] = [];

    for (const conflict of conflicts.values()) {
      const cutoff = await cutOffAssignment(repository, conflict, today);
      ended.push(cutoff.ended);

      this.logger.log("Vehicle assignment ended by a new link", {
        assignmentId: conflict.id,
        vehicleId: conflict.vehicleId,
        driverId: conflict.driverId,
        endedOn: toIsoDate(cutoff.lastDay),
        neverInEffect: cutoff.neverInEffect,
        pinnedTrips: cutoff.pinnedTrips,
      });
    }

    return ended;
  }
}
