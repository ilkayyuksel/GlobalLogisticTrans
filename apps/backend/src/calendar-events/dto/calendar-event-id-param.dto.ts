import { ApiProperty } from "@nestjs/swagger";
import { IsUUID } from "class-validator";

/**
 * Validating the identifier shape before it reaches the database turns a
 * malformed id into a clear 400 instead of a Prisma error.
 */
export class CalendarEventIdParamDto {
  @ApiProperty({
    format: "uuid",
    example: "7b1f4c2e-2d7a-4a55-9a51-0f3c2f1f9d10",
  })
  @IsUUID()
  id!: string;
}
