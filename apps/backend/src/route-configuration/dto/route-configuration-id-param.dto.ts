import { ApiProperty } from "@nestjs/swagger";
import { IsUUID } from "class-validator";

/**
 * The id of one route configuration, which is the id of its price record.
 *
 * Its own DTO rather than a shared one, following the convention every other
 * module here already uses: the parameter is documented in the terms of the
 * resource it identifies.
 */
export class RouteConfigurationIdParamDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  id!: string;
}
