import { ApiProperty } from "@nestjs/swagger";
import { IsUUID } from "class-validator";

/**
 * Validating the identifier shape before it reaches the database turns a
 * malformed id into a clear 400 instead of a Prisma error.
 */
export class NoteIdParamDto {
  @ApiProperty({
    format: "uuid",
    example: "5d2f0b8e-7a1c-4c3e-9b2d-1f6e8a4c3b21",
  })
  @IsUUID()
  id!: string;
}
