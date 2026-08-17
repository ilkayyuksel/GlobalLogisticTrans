import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsUUID } from "class-validator";

/**
 * The Trips whose snapshots an export needs, in one request.
 *
 * A cap rather than an open list: the ids travel in the query string, and a
 * request URL has practical limits that a caller cannot discover by trying.
 * A hundred UUIDs is about four kilobytes, comfortably inside every proxy
 * default, and lets a five-thousand-row export cost fifty requests instead of
 * five thousand.
 */
export const MAX_SNAPSHOT_TRIP_IDS = 100;

/** Comma-separated in the URL, an array by the time a controller sees it. */
function toIdList({ value }: { value: unknown }): unknown {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return value;
  }

  return value
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

export class PricingSnapshotsQueryDto {
  @ApiProperty({
    type: [String],
    format: "uuid",
    maxItems: MAX_SNAPSHOT_TRIP_IDS,
    description:
      "The Trips to read snapshots for, comma-separated. Trips with no snapshot are simply absent from the response — an unpriced Trip is an ordinary state, not an error.",
  })
  @Transform(toIdList)
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_SNAPSHOT_TRIP_IDS)
  @IsUUID("4", { each: true })
  tripIds!: string[];
}
