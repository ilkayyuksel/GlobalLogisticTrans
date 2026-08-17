import { ApiProperty } from "@nestjs/swagger";
import { Equals } from "class-validator";

/**
 * The body of an unlink request.
 *
 * It carries one field that may only be null, which looks redundant until you
 * consider what the alternative allows: a body accepting any group id would
 * turn this route into "move this Trip to that group", and moving a Trip
 * between groups silently changes the meaning of the group it left. Requiring
 * null makes the request say exactly what it does, and a client that tries to
 * reassign gets a 400 instead of a surprise.
 */
export class RemoveTripFromGroupDto {
  @ApiProperty({
    type: String,
    format: "uuid",
    nullable: true,
    enum: [null],
    description:
      "Must be null. Joining a group is done through POST /trip-groups.",
  })
  @Equals(null)
  tripGroupId!: null;
}
