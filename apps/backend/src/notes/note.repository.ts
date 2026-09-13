import { Injectable } from "@nestjs/common";
import { Note, Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";

/** Most recently changed first — the order the `updated_at` index exists for. */
const LIST_ORDER = [
  { updatedAt: "desc" },
  { id: "asc" },
] satisfies Prisma.NoteOrderByWithRelationInput[];

/**
 * Database access for notes. No rules: those are the service's.
 */
@Injectable()
export class NoteRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every note, in one query ordered by PostgreSQL. Not paged: notes are typed
   * by hand, one at a time, and the page shows them all.
   */
  findAll(): Promise<Note[]> {
    return this.prisma.note.findMany({ orderBy: LIST_ORDER });
  }

  findById(id: string): Promise<Note | null> {
    return this.prisma.note.findUnique({ where: { id } });
  }

  create(content: string): Promise<Note> {
    return this.prisma.note.create({ data: { content } });
  }

  update(id: string, content: string): Promise<Note> {
    return this.prisma.note.update({ where: { id }, data: { content } });
  }

  /**
   * Removes the row physically; the model allows notes to be deleted. Resolves
   * false when nothing was there to remove.
   */
  async delete(id: string): Promise<boolean> {
    const { count } = await this.prisma.note.deleteMany({ where: { id } });

    return count === 1;
  }
}
