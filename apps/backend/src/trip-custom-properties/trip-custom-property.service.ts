import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { CustomPropertyService } from "../custom-properties/custom-property.service";
import { AppLoggerService } from "../logger/app-logger.service";
import { TripService } from "../trips/trip.service";
import { AssignCustomPropertyDto } from "./dto/assign-custom-property.dto";
import {
  TripCustomPropertiesDto,
  TripCustomPropertyResponseDto,
  toTripCustomPropertyResponse,
} from "./dto/trip-custom-property-response.dto";
import {
  DuplicateTripCustomPropertyException,
  InactiveCustomPropertyException,
  TripCustomPropertyNotFoundException,
} from "./exceptions/trip-custom-property.exceptions";
import {
  TripCustomPropertyRepository,
  TripCustomPropertyWithProperty,
} from "./trip-custom-property.repository";

/** Prisma's unique-constraint violation code. */
const PRISMA_UNIQUE_VIOLATION = "P2002";

/**
 * Manages which Custom Properties a Trip carries.
 *
 * It records assignments and nothing more. It never prices a property, never
 * touches the Trip's pricing snapshot and never changes the Trip's status —
 * Custom Properties are a manual planning field, and assigning one is a
 * planning decision whose pricing consequence is produced later by the Pricing
 * Engine.
 *
 * An assignment is a current fact rather than a historical one, which is why
 * this is the only module in the system with a real delete. Removing an
 * assignment cannot damage pricing history: a calculated amount is frozen in
 * `trip_pricing_item` and stops depending on this row the moment it is written.
 *
 * Business values are never logged. A property's name and configured price are
 * commercial information; only identifiers appear in the log.
 */
@Injectable()
export class TripCustomPropertyService {
  constructor(
    private readonly repository: TripCustomPropertyRepository,
    private readonly tripService: TripService,
    private readonly customPropertyService: CustomPropertyService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(TripCustomPropertyService.name);
  }

  /**
   * Every property a Trip carries, in display order.
   *
   * The Trip's existence is verified first, so an unknown Trip is reported as
   * 404 rather than as a Trip with no properties — the two mean very different
   * things to a caller about to price it.
   */
  async findByTripId(tripId: string): Promise<TripCustomPropertiesDto> {
    await this.tripService.findById(tripId);

    const assignments = await this.repository.findByTripId(tripId);

    return { items: assignments.map(toTripCustomPropertyResponse) };
  }

  /**
   * Assigns a Custom Property to a Trip.
   *
   * Both references are verified and the property's active state is checked
   * before the write, so a rejected request never leaves a row pointing at
   * something unusable.
   */
  async assign(
    dto: AssignCustomPropertyDto,
  ): Promise<TripCustomPropertyResponseDto> {
    await this.tripService.findById(dto.tripId);
    await this.assertPropertyAssignable(dto.customPropertyId);
    await this.assertNotAlreadyAssigned(dto.tripId, dto.customPropertyId);

    const created = await this.runGuardingAssignment(dto, () =>
      this.repository.create({
        tripId: dto.tripId,
        customPropertyId: dto.customPropertyId,
      }),
    );

    // Neither the property name nor its price is logged.
    this.logger.log("Custom property assigned to Trip", {
      tripCustomPropertyId: created.id,
      tripId: created.tripId,
      customPropertyId: created.customPropertyId,
    });

    return toTripCustomPropertyResponse(created);
  }

  /**
   * Removes an assignment.
   *
   * Never blocked by an existing pricing snapshot. The amount a property
   * contributed was frozen into its pricing item when the calculation ran, so
   * a historical breakdown stays complete and explainable after the property
   * stops being assigned. Only a future calculation sees the change.
   */
  async remove(id: string): Promise<TripCustomPropertyResponseDto> {
    const assignment = await this.requireAssignment(id);

    const removed = await this.repository.delete(assignment.id);

    this.logger.log("Custom property removed from Trip", {
      tripCustomPropertyId: removed.id,
      tripId: removed.tripId,
      customPropertyId: removed.customPropertyId,
    });

    return toTripCustomPropertyResponse(removed);
  }

  private async requireAssignment(
    id: string,
  ): Promise<TripCustomPropertyWithProperty> {
    const assignment = await this.repository.findById(id);

    if (!assignment) {
      throw new TripCustomPropertyNotFoundException(id);
    }

    return assignment;
  }

  /**
   * Only an active Custom Property may be assigned.
   *
   * Existence is delegated to CustomPropertyService, which reuses its lookup
   * and its 404 rather than duplicating either here. A property deactivated
   * after assignment stays on the Trips that already carry it — this rule
   * governs new assignments only.
   */
  private async assertPropertyAssignable(
    customPropertyId: string,
  ): Promise<void> {
    const customProperty =
      await this.customPropertyService.findById(customPropertyId);

    if (!customProperty.isActive) {
      this.logger.warn("Rejected assignment of an inactive custom property", {
        customPropertyId,
      });

      throw new InactiveCustomPropertyException(customPropertyId);
    }
  }

  private async assertNotAlreadyAssigned(
    tripId: string,
    customPropertyId: string,
  ): Promise<void> {
    const existing = await this.repository.findByTripAndProperty(
      tripId,
      customPropertyId,
    );

    if (existing) {
      this.logger.warn("Rejected duplicate custom property assignment", {
        tripId,
        customPropertyId,
        conflictingAssignmentId: existing.id,
      });

      throw new DuplicateTripCustomPropertyException(tripId, customPropertyId);
    }
  }

  /**
   * The check above is a courtesy that produces a good error message; it cannot
   * be atomic. The unique index on the pair is the real guard, so its violation
   * is translated here rather than escaping as a raw Prisma error.
   */
  private async runGuardingAssignment<TResult>(
    dto: AssignCustomPropertyDto,
    operation: () => Promise<TResult>,
  ): Promise<TResult> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PRISMA_UNIQUE_VIOLATION
      ) {
        throw new DuplicateTripCustomPropertyException(
          dto.tripId,
          dto.customPropertyId,
        );
      }

      throw error;
    }
  }
}
