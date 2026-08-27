import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Driver, Vehicle } from "@prisma/client";

import { PaginationMetaDto } from "../../common/dto/pagination-meta.dto";

/**
 * The Driver a Vehicle is assigned to today, as a list needs them.
 *
 * ── DELIBERATELY TWO FIELDS ─────────────────────────────────────────────────
 * A name to show and an id to link by. The phone number, the email, the
 * emergency contact and the licence number are all absent: a fleet list has no
 * use for any of them, and putting a driver's contact details into every row of
 * every vehicle page would spread them a great deal further than the Driver
 * screen, where somebody asked to see them.
 */
export class CurrentDriverDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "Jan Peeters" })
  name!: string;

  @ApiProperty({
    description:
      "False when the Driver has since been deactivated. Deactivating somebody does not silently unassign the truck they are still down as driving.",
  })
  isActive!: boolean;
}

/**
 * Public shape of a Vehicle. The Prisma model is never returned directly, so
 * adding a column cannot silently widen the API contract.
 */
export class VehicleResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: "1-ABC-123" })
  licensePlate!: string;

  @ApiProperty({ description: "Six-digit hex, lowercase.", example: "#2563eb" })
  displayColor!: string;

  @ApiPropertyOptional({ nullable: true })
  description!: string | null;

  @ApiPropertyOptional({ nullable: true, example: "Volvo" })
  brand!: string | null;

  @ApiPropertyOptional({ nullable: true, example: "FH16" })
  model!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 2021 })
  year!: number | null;

  @ApiPropertyOptional({ nullable: true })
  notes!: string | null;

  @ApiProperty({
    description:
      "Inactive vehicles cannot be assigned to new Trips but remain linked to historical Trips.",
  })
  isActive!: boolean;

  @ApiProperty({ format: "date-time" })
  @ApiProperty({
    type: () => CurrentDriverDto,
    nullable: true,
    description:
      "The Driver assigned to this Vehicle TODAY, from VehicleAssignment. Null when nobody is assigned. Never derived from a Trip: a Trip records who drove on a day, which is a different question.",
  })
  currentDriver!: CurrentDriverDto | null;

  createdAt!: Date;

  @ApiProperty({ format: "date-time" })
  updatedAt!: Date;
}

/** Concrete type rather than a generic, so the OpenAPI schema stays accurate. */
export class PaginatedVehiclesDto {
  @ApiProperty({ type: [VehicleResponseDto] })
  items!: VehicleResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}

/**
 * `currentDriver` is PASSED IN rather than looked up here.
 *
 * A mapper that queried would be a mapper called once per row, which is the
 * N+1 this whole feature had to avoid. The caller resolves the whole page in
 * one query and hands each row its answer; a caller with no answer to give
 * passes nothing, and the field is null.
 */
export function toVehicleResponse(
  vehicle: Vehicle,
  currentDriver: Driver | null = null,
): VehicleResponseDto {
  return {
    id: vehicle.id,
    licensePlate: vehicle.licensePlate,
    displayColor: vehicle.displayColor,
    currentDriver: currentDriver
      ? {
          id: currentDriver.id,
          name: currentDriver.name,
          isActive: currentDriver.isActive,
        }
      : null,
    description: vehicle.description,
    brand: vehicle.brand,
    model: vehicle.model,
    year: vehicle.year,
    notes: vehicle.notes,
    isActive: vehicle.isActive,
    createdAt: vehicle.createdAt,
    updatedAt: vehicle.updatedAt,
  };
}
