import { Module } from "@nestjs/common";

import { NoteController } from "./note.controller";
import { NoteRepository } from "./note.repository";
import { NoteService } from "./note.service";

/**
 * Notes.
 *
 * PrismaModule and LoggerModule are global, so nothing needs importing, and
 * nothing is exported: notes belong to no other domain.
 */
@Module({
  controllers: [NoteController],
  providers: [NoteService, NoteRepository],
})
export class NoteModule {}
