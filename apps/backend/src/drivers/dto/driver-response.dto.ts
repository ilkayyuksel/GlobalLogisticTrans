import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Driver } from "@prisma/client";

import { PaginationMetaDto } from "../../common/dto/pagination-meta.dto";

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

export function toDriverResponse(driver: Driver): DriverResponseDto {
  return {
    id: driver.id,
    name: driver.name,
    licenceNumber: driver.licenceNumber,
    phoneNumber: driver.phoneNumber,
    email: driver.email,
    emergencyContact: driver.emergencyContact,
    notes: driver.notes,
    isActive: driver.isActive,
    createdAt: driver.createdAt,
    updatedAt: driver.updatedAt,
  };
}
