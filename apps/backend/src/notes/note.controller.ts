import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";

import { CreateNoteDto } from "./dto/create-note.dto";
import { NoteIdParamDto } from "./dto/note-id-param.dto";
import { NoteResponseDto } from "./dto/note-response.dto";
import { UpdateNoteDto } from "./dto/update-note.dto";
import { NoteService } from "./note.service";

/**
 * Notes: plain text, added, changed and deleted by the Administrator.
 */
@ApiTags("Notes")
@Controller("notes")
export class NoteController {
  constructor(private readonly noteService: NoteService) {}

  @Get()
  @ApiOperation({
    summary: "List notes",
    description:
      "Every note, ordered by the database: the most recently changed first.",
  })
  @ApiOkResponse({ type: [NoteResponseDto] })
  findAll(): Promise<NoteResponseDto[]> {
    return this.noteService.findAll();
  }

  @Post()
  @ApiOperation({
    summary: "Add a note",
    description:
      "A note is its text. Surrounding whitespace is removed; empty text is refused.",
  })
  @ApiCreatedResponse({ type: NoteResponseDto })
  @ApiBadRequestResponse({
    description:
      "No text, text of only whitespace, text that is too long, or an unknown field.",
  })
  create(@Body() dto: CreateNoteDto): Promise<NoteResponseDto> {
    return this.noteService.create(dto);
  }

  @Patch(":id")
  @ApiOperation({
    summary: "Change a note",
    description: "Replaces the note's text, under the same rules as a new note.",
  })
  @ApiOkResponse({ type: NoteResponseDto })
  @ApiBadRequestResponse({
    description:
      "An invalid id, no text, text of only whitespace, text that is too long, or an unknown field.",
  })
  @ApiNotFoundResponse({ description: "No note with that id." })
  update(
    @Param() params: NoteIdParamDto,
    @Body() dto: UpdateNoteDto,
  ): Promise<NoteResponseDto> {
    return this.noteService.update(params.id, dto);
  }

  /**
   * 200 with the removed note rather than 204, the convention every DELETE in
   * this API follows: each response carries the standard envelope.
   */
  @Delete(":id")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Delete a note",
    description:
      "Physically removes the note. Answers with the note that was removed.",
  })
  @ApiOkResponse({ type: NoteResponseDto })
  @ApiBadRequestResponse({ description: "The id is not a valid UUID." })
  @ApiNotFoundResponse({
    description: "No note with that id, including one already deleted.",
  })
  remove(@Param() params: NoteIdParamDto): Promise<NoteResponseDto> {
    return this.noteService.remove(params.id);
  }
}
