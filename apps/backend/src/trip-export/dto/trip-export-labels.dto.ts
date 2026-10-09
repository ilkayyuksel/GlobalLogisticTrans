import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from "class-validator";

/** The same batch size the snapshots read takes, for the same exports. */
export const MAX_LABEL_TRIP_IDS = 100;

/** A display word, not text to store: short enough to sit in a cell. */
const MAX_WAITING_WORD_LENGTH = 40;

/** `a,b,c` from a query string; an array is passed through unchanged. */
function toIdList({ value }: { value: unknown }): unknown {
  if (typeof value !== "string") {
    return value;
  }

  return value
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

export class TripExportLabelsQueryDto {
  @ApiProperty({
    type: [String],
    format: "uuid",
    maxItems: MAX_LABEL_TRIP_IDS,
    description:
      "The Trips to describe, comma-separated. An unknown id is simply absent from the response.",
  })
  @Transform(toIdList)
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_LABEL_TRIP_IDS)
  @IsUUID("4", { each: true })
  tripIds!: string[];

  @ApiPropertyOptional({
    example: "Wachttijd",
    description:
      "The word for waiting time in the operator's own language. The client owns translation; the server only places the word. Defaults to the documents' own: Wachttijd.",
  })
  @IsOptional()
  @IsString()
  @Length(1, MAX_WAITING_WORD_LENGTH)
  waitingWord?: string;

  @ApiPropertyOptional({
    example: "volgende dag",
    description:
      "The words for a waiting window that ends the day after it began, in the operator's own language. Placed in brackets after the window. Defaults to the documents' own: volgende dag.",
  })
  @IsOptional()
  @IsString()
  @Length(1, MAX_WAITING_WORD_LENGTH)
  nextDayWord?: string;
}

/** What an export prints about one Trip, beside its amounts. */
export class TripExportLabelsDto {
  @ApiProperty({ format: "uuid" })
  tripId!: string;

  @ApiProperty({
    example: "Aan/Afkoppelen | TAR | Wachttijd 08:30-14:00 | CC4139505",
    description:
      "The Remarks column: the Trip's Custom Properties, TAR when the Engine charged it, the waiting window and every Cost Confirmation reference, in that order. Empty when there is nothing to say.",
  })
  remarks!: string;

  @ApiProperty({
    nullable: true,
    example: "Wachttijd 08:30-14:00",
    description:
      "The waiting window — followed by the next-day words in brackets when it ends the following day — or its duration, or null when none was recorded.",
  })
  waitingLabel!: string | null;

  @ApiProperty({
    description: "Whether the Engine charged TAR, read from the stored snapshot.",
  })
  tarCharged!: boolean;

  @ApiProperty({
    type: [String],
    example: ["CC4156173", "CC4139505"],
    description:
      "Every Cost Confirmation reference of the Trip, newest first, as the Remarks text ends with them. Empty when the Trip has none.",
  })
  costConfirmations!: string[];
}
