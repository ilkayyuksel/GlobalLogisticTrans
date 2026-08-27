import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Driver, Vehicle } from "@prisma/client";

import { PaginationMetaDto } from "../../common/dto/pagination-meta.dto";

/**
 * The Vehicle a Driver is assigned to today, as a list needs them.
 *
 * A plate to show and an id to link by, plus the colour the planning already
 * uses to identify a truck at a glance. The brand, model, year and notes are
 * absent: none of them helps answer "which truck is this person on".
 */
export class CurrentVehicleDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "1-ABC-123" })
  licensePlate!: string;

  @ApiProperty({ description: "Six-digit hex, lowercase.", example: "#2563eb" })
  displayColor!: string;

  @ApiProperty({
    description: "False when the Vehicle has since been deactivated.",
  })
  isActive!: boolean;
}

/**
 * Public shape of a Driver. The Prisma model is never returned directly, so
 * adding a column to the schema cannot silently widen the API contract.
 */
export class DriverResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "Jan Peeters" })
  name!: string;

  @ApiPropertyOptional({ nullable: true, example: "B-1234567" })
  licenceNumber!: string | null;

  @ApiPropertyOptional({ nullable: true, example: "+32 470 11 22 33" })
  phoneNumber!: string | null;

  @ApiProperty({
    type: () => CurrentVehicleDto,
    nullable: true,
    description:
      "The Vehicle this Driver is assigned to TODAY, from VehicleAssignment. Null when they have none. Never derived from a Trip.",
  })
  currentVehicle!: CurrentVehicleDto | null;

  @ApiPropertyOptional({ nullable: true, example: "jan.peeters@example.com" })
  email!: string | null;

  @ApiPropertyOptional({ nullable: true })
  emergencyContact!: string | null;

  @ApiPropertyOptional({ nullable: true })
  notes!: string | null;

  @ApiProperty({
    description:
      "Inactive drivers cannot be assigned to new work but remain linked to historical Trips.",
  })
  isActive!: boolean;

  @ApiProperty({ format: "date-time" })
  createdAt!: Date;

  @ApiProperty({ format: "date-time" })
  updatedAt!: Date;
}

/** Concrete type rather than a generic, so the OpenAPI schema stays accurate. */
export class PaginatedDriversDto {
  @ApiProperty({ type: [DriverResponseDto] })
  items!: DriverResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}

/**
 * `currentVehicle` is PASSED IN rather than looked up here — see the mirror of
 * this note on `toVehicleResponse`. A mapper that queried would be a query per
 * row.
 */
export function toDriverResponse(
  driver: Driver,
  currentVehicle: Vehicle | null = null,
): DriverResponseDto {
  return {
    id: driver.id,
    name: driver.name,
    licenceNumber: driver.licenceNumber,
    phoneNumber: driver.phoneNumber,
    currentVehicle: currentVehicle
      ? {
          id: currentVehicle.id,
          licensePlate: currentVehicle.licensePlate,
          displayColor: currentVehicle.displayColor,
          isActive: currentVehicle.isActive,
        }
      : null,
    email: driver.email,
    emergencyContact: driver.emergencyContact,
    notes: driver.notes,
    isActive: driver.isActive,
    createdAt: driver.createdAt,
    updatedAt: driver.updatedAt,
  };
}
