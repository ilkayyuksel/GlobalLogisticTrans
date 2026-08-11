import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { VehicleAssignment } from "@prisma/client";

import { PaginationMetaDto } from "../../common/dto/pagination-meta.dto";
import { toIsoDate } from "../../common/dates";

/**
 * Public shape of a VehicleAssignment.
 *
 * Dates are rendered as plain calendar strings rather than timestamps: the
 * underlying columns are DATE, and serialising them as ISO datetimes would
 * invite timezone shifts on the client.
 *
 * Only the vehicle and driver identifiers are returned. Embedding the related
 * records would add a join every module then depends on; callers that need the
 * detail fetch it from the owning module.
 */
export class VehicleAssignmentResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ format: "uuid" })
  vehicleId!: string;

  @ApiProperty({ format: "uuid" })
  driverId!: string;

  @ApiProperty({ description: "Inclusive first day.", example: "2026-03-01" })
  validFrom!: string;

  @ApiPropertyOptional({
    description: "Inclusive last day. Null means the assignment is open-ended.",
    nullable: true,
    example: "2026-06-30",
  })
  validTo!: string | null;

  @ApiProperty({
    description: "True while the assignment has no end date.",
  })
  isOpenEnded!: boolean;

  @ApiPropertyOptional({ nullable: true })
  notes!: string | null;

  @ApiProperty({ format: "date-time" })
  createdAt!: Date;

  @ApiProperty({ format: "date-time" })
  updatedAt!: Date;
}

/** Concrete type rather than a generic, so the OpenAPI schema stays accurate. */
export class PaginatedVehicleAssignmentsDto {
  @ApiProperty({ type: [VehicleAssignmentResponseDto] })
  items!: VehicleAssignmentResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}

export function toVehicleAssignmentResponse(
  assignment: VehicleAssignment,
): VehicleAssignmentResponseDto {
  return {
    id: assignment.id,
    vehicleId: assignment.vehicleId,
    driverId: assignment.driverId,
    validFrom: toIsoDate(assignment.validFrom),
    validTo: assignment.validTo ? toIsoDate(assignment.validTo) : null,
    isOpenEnded: assignment.validTo === null,
    notes: assignment.notes,
    createdAt: assignment.createdAt,
    updatedAt: assignment.updatedAt,
  };
}
