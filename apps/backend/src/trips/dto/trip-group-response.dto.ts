import { ApiProperty } from "@nestjs/swagger";

import { TripResponseDto } from "./trip-response.dto";

/**
 * A group and the Trips in it.
 *
 * The id is echoed at the top rather than left to be read off a Trip: a client
 * that has just created a group needs it to fetch the group later, and digging
 * it out of the first member would be a guess about which member exists.
 *
 * There is no "type" here. An imported Combination and a manual group are the
 * same row, and the difference lives in how they came to be — which the Trips
 * themselves already show.
 */
export class TripGroupResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({ example: 2, description: "How many Trips the group holds." })
  tripCount!: number;

  @ApiProperty({ type: [TripResponseDto] })
  trips!: TripResponseDto[];
}

export function toTripGroupResponse(
  trips: readonly TripResponseDto[],
): TripGroupResponseDto {
  return {
    // Every Trip in the group carries the same id; the first is as good as any.
    id: trips[0].tripGroupId as string,
    tripCount: trips.length,
    trips: [...trips],
  };
}
