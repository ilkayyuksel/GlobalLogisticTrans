import { ApiProperty } from "@nestjs/swagger";
import { TripStatus } from "@prisma/client";
import { IsIn } from "class-validator";

import {
  CHANGEABLE_TRIP_STATUSES,
  ChangeableTripStatus,
} from "../trip-status.rules";

/**
 * Target status for the status endpoint.
 *
 * DELETED is not accepted here. Soft delete and restore are separate operations
 * with their own preconditions, and the model insists that CANCELLED (a business
 * cancellation) and DELETED (an administrative soft delete) never be treated as
 * the same value — sharing one endpoint would invite exactly that.
 */
export class ChangeTripStatusDto {
  @ApiProperty({
    enum: CHANGEABLE_TRIP_STATUSES,
    description:
      "Target status. Allowed moves: OPEN to CLOSED, OPEN to CANCELLED, CANCELLED back to OPEN. CLOSED is terminal.",
    example: TripStatus.CLOSED,
  })
  @IsIn([...CHANGEABLE_TRIP_STATUSES])
  status!: ChangeableTripStatus;
}
