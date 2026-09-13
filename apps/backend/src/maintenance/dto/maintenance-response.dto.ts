import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  Maintenance,
  MaintenanceCompletion,
  MaintenanceStatus,
  Vehicle,
} from "@prisma/client";

import { toIsoDate } from "../../common/dates";
import { MONEY_DECIMAL_PLACES } from "../../common/dto/money";
import { PaginationMetaDto } from "../../common/dto/pagination-meta.dto";
import {
  MaintenanceUrgencyLevel,
  maintenanceUrgency,
} from "../maintenance-urgency";

/**
 * Public shape of a maintenance record.
 *
 * `cost` is a fixed-2 STRING, never a JSON number: the column is NUMERIC(12,2)
 * and rendering it as a float would reintroduce the binary rounding the decimal
 * type exists to avoid. Nothing on the client side adds these; totals come from
 * the summary endpoint, which sums them in the database.
 *
 * Dates are "YYYY-MM-DD" — they are DATE columns with no timezone, and
 * serialising them as timestamps would shift a service day for anyone west of
 * UTC.
 *
 * The Vehicle is embedded as a small summary so a list of maintenance can name
 * its trucks in one request. Trailer maintenance exists in the column but has
 * no UI in this version.
 */
export class MaintenanceVehicleSummaryDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "1-ABC-123" })
  licensePlate!: string;

  @ApiProperty({ example: "#2563eb" })
  displayColor!: string;

  @ApiProperty({
    description: "False when the Vehicle has since been deactivated.",
  })
  isActive!: boolean;
}

export class MaintenanceUrgencyDto {
  @ApiProperty({
    enum: Object.values(MaintenanceUrgencyLevel),
    description:
      "OVERDUE when the planned date has passed, TODAY when it is today, UPCOMING when it is still to come.",
  })
  level!: MaintenanceUrgencyLevel;

  @ApiProperty({
    description: "Calendar days past the planned date. Zero unless OVERDUE.",
    example: 4,
  })
  daysOverdue!: number;
}

export class MaintenanceResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiPropertyOptional({ format: "uuid", nullable: true })
  vehicleId!: string | null;

  @ApiPropertyOptional({
    type: MaintenanceVehicleSummaryDto,
    nullable: true,
    description: "Null for trailer maintenance, which has no UI in this version.",
  })
  vehicle!: MaintenanceVehicleSummaryDto | null;

  @ApiProperty({ enum: MaintenanceStatus })
  status!: MaintenanceStatus;

  @ApiPropertyOptional({ nullable: true, example: "Onderhoud" })
  maintenanceType!: string | null;

  @ApiProperty({
    format: "date",
    example: "2026-08-14",
    description:
      "The day the work was done or is planned for. For a PLANNED record, its current planning.",
  })
  maintenanceDate!: string;

  @ApiProperty()
  description!: string;

  @ApiPropertyOptional({
    nullable: true,
    description:
      "Odometer reading when this work was done. NOT the vehicle's current mileage.",
    example: 245000,
  })
  mileage!: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: "Fixed-2 string, e.g. \"1250.50\". Never a JSON number.",
    example: "1250.50",
  })
  cost!: string | null;

  @ApiPropertyOptional({ nullable: true, example: "Garage Peeters" })
  workshop!: string | null;

  @ApiPropertyOptional({ format: "date", nullable: true })
  nextMaintenanceDate!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 275000 })
  nextMaintenanceMileage!: number | null;

  @ApiPropertyOptional({ nullable: true })
  notes!: string | null;

  @ApiPropertyOptional({
    type: MaintenanceUrgencyDto,
    nullable: true,
    description:
      "How pressing the record is today, decided from its status and maintenance date only. Null for any status but PLANNED. Mileage never plays a part.",
  })
  urgency!: MaintenanceUrgencyDto | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

/** One carried-out cycle, as it was when it was completed. */
export class MaintenanceCompletionDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({
    format: "date",
    description: "The date the record was planned for when this cycle was done.",
  })
  plannedDate!: string;

  @ApiProperty({ format: "date", description: "The day the work was done." })
  completedOn!: string;

  @ApiProperty({
    format: "date",
    description: "The date the record was planned again for.",
  })
  nextMaintenanceDate!: string;

  @ApiPropertyOptional({ nullable: true })
  notes!: string | null;

  @ApiPropertyOptional({ nullable: true, example: "Onderhoud" })
  maintenanceType!: string | null;

  @ApiProperty()
  description!: string;

  @ApiProperty({ description: "When the completion was registered." })
  createdAt!: Date;
}

/** One record with its full history, oldest completion first. */
export class MaintenanceDetailDto extends MaintenanceResponseDto {
  @ApiProperty({ type: [MaintenanceCompletionDto] })
  completions!: MaintenanceCompletionDto[];
}

export class PaginatedMaintenanceDto {
  @ApiProperty({ type: [MaintenanceResponseDto] })
  items!: MaintenanceResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}

export type MaintenanceWithVehicle = Maintenance & {
  vehicle: Vehicle | null;
};

export type MaintenanceWithHistory = MaintenanceWithVehicle & {
  completions: MaintenanceCompletion[];
};

/** `today` is the UTC midnight the urgency is decided against. */
export function toMaintenanceResponse(
  maintenance: MaintenanceWithVehicle,
  today: Date,
): MaintenanceResponseDto {
  return {
    id: maintenance.id,
    vehicleId: maintenance.vehicleId,
    vehicle: maintenance.vehicle
      ? {
          id: maintenance.vehicle.id,
          licensePlate: maintenance.vehicle.licensePlate,
          displayColor: maintenance.vehicle.displayColor,
          isActive: maintenance.vehicle.isActive,
        }
      : null,
    status: maintenance.status,
    maintenanceType: maintenance.maintenanceType,
    maintenanceDate: toIsoDate(maintenance.maintenanceDate),
    description: maintenance.description,
    mileage: maintenance.mileage,
    cost:
      maintenance.cost === null
        ? null
        : maintenance.cost.toFixed(MONEY_DECIMAL_PLACES),
    workshop: maintenance.workshop,
    nextMaintenanceDate:
      maintenance.nextMaintenanceDate === null
        ? null
        : toIsoDate(maintenance.nextMaintenanceDate),
    nextMaintenanceMileage: maintenance.nextMaintenanceMileage,
    notes: maintenance.notes,
    urgency: maintenanceUrgency(maintenance, today),
    createdAt: maintenance.createdAt,
    updatedAt: maintenance.updatedAt,
  };
}

export function toMaintenanceDetail(
  maintenance: MaintenanceWithHistory,
  today: Date,
): MaintenanceDetailDto {
  return {
    ...toMaintenanceResponse(maintenance, today),
    completions: maintenance.completions.map(toCompletionResponse),
  };
}

function toCompletionResponse(
  completion: MaintenanceCompletion,
): MaintenanceCompletionDto {
  return {
    id: completion.id,
    plannedDate: toIsoDate(completion.plannedDate),
    completedOn: toIsoDate(completion.completedOn),
    nextMaintenanceDate: toIsoDate(completion.nextMaintenanceDate),
    notes: completion.notes,
    maintenanceType: completion.maintenanceType,
    description: completion.description,
    createdAt: completion.createdAt,
  };
}
