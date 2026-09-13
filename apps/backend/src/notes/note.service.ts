import { Injectable } from "@nestjs/common";
import { Note } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { CreateNoteDto } from "./dto/create-note.dto";
import { NoteResponseDto, toNoteResponse } from "./dto/note-response.dto";
import { UpdateNoteDto } from "./dto/update-note.dto";
import { NoteNotFoundException } from "./exceptions/note.exceptions";
import { NoteRepository } from "./note.repository";

/**
 * Notes: free text the Administrator keeps for themselves.
 *
 * A note is its text and nothing else — no title, category, tag, priority,
 * deadline, status or owner. Adding, changing and deleting are the whole of it.
 *
 * The text is never written to the log; ids are.
 */
@Injectable()
export class NoteService {
  constructor(
    private readonly repository: NoteRepository,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(NoteService.name);
  }

  async findAll(): Promise<NoteResponseDto[]> {
    return (await this.repository.findAll()).map(toNoteResponse);
  }

  async create(dto: CreateNoteDto): Promise<NoteResponseDto> {
    const created = await this.repository.create(dto.content);

    this.logger.log("Note created", { noteId: created.id });

    return toNoteResponse(created);
  }

  async update(id: string, dto: UpdateNoteDto): Promise<NoteResponseDto> {
    await this.requireNote(id);

    const updated = await this.repository.update(id, dto.content);

    this.logger.log("Note updated", { noteId: id });

    return toNoteResponse(updated);
  }

  /** Answers with the note that was removed. */
  async remove(id: string): Promise<NoteResponseDto> {
    const existing = await this.requireNote(id);

    if (!(await this.repository.delete(id))) {
      // Another request removed it between the read and now.
      throw new NoteNotFoundException(id);
    }

    this.logger.log("Note deleted", { noteId: id });

    return toNoteResponse(existing);
  }

  private async requireNote(id: string): Promise<Note> {
    const note = await this.repository.findById(id);

    if (!note) {
      throw new NoteNotFoundException(id);
    }

    return note;
  }
}
