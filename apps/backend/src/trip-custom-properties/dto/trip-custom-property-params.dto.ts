import { ApiProperty } from "@nestjs/swagger";
import { IsUUID } from "class-validator";

/**
 * Validating the identifier shape before it reaches the database turns a
 * malformed id into a clear 400 instead of a Prisma error.
 *
 * Two classes rather than one, because the path segment is named differently on
 * the two routes and the DTO property must match the segment.
 */

export class TripCustomPropertyIdParamDto {
  @ApiProperty({
    format: "uuid",
    example: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  })
  @IsUUID()
  id!: string;
}

export class TripIdParamDto {
  @ApiProperty({
    format: "uuid",
    example: "9c858901-8a57-4791-81fe-4c455b099bc9",
  })
  @IsUUID()
  tripId!: string;
}
