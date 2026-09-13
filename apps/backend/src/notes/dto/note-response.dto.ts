import { ApiProperty } from "@nestjs/swagger";
import { Note } from "@prisma/client";

/** A note: its text, and when it was written and last changed. */
export class NoteResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty({
    description: "Plain text, line breaks kept.",
    example: "Reserve chauffeur bellen",
  })
  content!: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export function toNoteResponse(note: Note): NoteResponseDto {
  return {
    id: note.id,
    content: note.content,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}
