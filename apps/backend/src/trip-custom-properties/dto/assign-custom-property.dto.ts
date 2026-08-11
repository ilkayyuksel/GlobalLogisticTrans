import { ApiProperty } from "@nestjs/swagger";
import { IsUUID } from "class-validator";

/**
 * Body for assigning one Custom Property to one Trip.
 *
 * Two identifiers and nothing else. An assignment carries no values of its own:
 * the price comes from the referenced property's current configuration at
 * calculation time, and the moment of assignment is the row's own timestamp.
 *
 * database_model.md §4.21 lists a Trip-specific price override and assignment
 * notes as future extensions. Neither exists as a column, so neither is
 * accepted here.
 */
export class AssignCustomPropertyDto {
  @ApiProperty({
    format: "uuid",
    description: "The Trip that receives the property. Must exist.",
  })
  @IsUUID()
  tripId!: string;

  @ApiProperty({
    format: "uuid",
    description:
      "The Custom Property to assign. Must exist and must still be active.",
  })
  @IsUUID()
  customPropertyId!: string;
}
