import { ApiProperty } from "@nestjs/swagger";
import { IsUUID } from "class-validator";

/**
 * Validating the identifier shape before it reaches the database turns a
 * malformed id into a clear 400 instead of a Prisma error.
 */
export class DriverIdParamDto {
  @ApiProperty({
    format: "uuid",
    example: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  })
  @IsUUID()
  id!: string;
}
