import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsString, MaxLength, MinLength } from "class-validator";

import { trim } from "../../common/dto/transforms";

/**
 * The column holds text of any length; this bounds what one request can store.
 * Tens of pages of text — far beyond a note, and well inside the request size
 * the API accepts.
 */
export const NOTE_CONTENT_MAX_LENGTH = 50_000;

/**
 * A note is its text.
 *
 * Required: the surrounding whitespace is removed first, so a note of nothing
 * but spaces or blank lines is empty and refused. Line breaks inside the text
 * are kept.
 */
export class CreateNoteDto {
  @ApiProperty({
    description:
      "Plain text. Surrounding whitespace is removed; what remains may not be empty.",
    maxLength: NOTE_CONTENT_MAX_LENGTH,
    example: "Reserve chauffeur bellen",
  })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(NOTE_CONTENT_MAX_LENGTH)
  content!: string;
}
