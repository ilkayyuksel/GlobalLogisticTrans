import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Vehicle } from "@prisma/client";

import { PaginationMetaDto } from "../../common/dto/pagination-meta.dto";

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

export function toVehicleResponse(vehicle: Vehicle): VehicleResponseDto {
  return {
    id: vehicle.id,
    licensePlate: vehicle.licensePlate,
    displayColor: vehicle.displayColor,
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
