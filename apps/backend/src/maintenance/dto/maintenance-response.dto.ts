import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Maintenance, MaintenanceStatus, Vehicle } from "@prisma/client";

import { toIsoDate } from "../../common/dates";
import { MONEY_DECIMAL_PLACES } from "../../common/dto/money";
import { PaginationMetaDto } from "../../common/dto/pagination-meta.dto";

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

  @ApiProperty({ format: "date", example: "2026-08-14" })
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

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
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

export function toMaintenanceResponse(
  maintenance: MaintenanceWithVehicle,
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
    createdAt: maintenance.createdAt,
    updatedAt: maintenance.updatedAt,
  };
}
