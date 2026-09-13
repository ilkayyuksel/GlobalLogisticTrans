import { PrismaService } from "../prisma/prisma.service";
import { NoteRepository } from "./note.repository";

/** What notes ask of the database, held to its contract. */

const ID = "5d2f0b8e-7a1c-4c3e-9b2d-1f6e8a4c3b21";

function prismaDouble(deletedCount = 1) {
  const prisma = {
    note: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: deletedCount }),
    },
  };

  return {
    prisma,
    repository: new NoteRepository(prisma as unknown as PrismaService),
  };
}

describe("NoteRepository", () => {
  it("lists every note, the most recently changed first, id as tie-break", async () => {
    const { prisma, repository } = prismaDouble();

    await repository.findAll();

    expect(prisma.note.findMany).toHaveBeenCalledWith({
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    });
  });

  it("stores the text and nothing else", async () => {
    const { prisma, repository } = prismaDouble();

    await repository.create("Reserve chauffeur bellen");

    expect(prisma.note.create).toHaveBeenCalledWith({
      data: { content: "Reserve chauffeur bellen" },
    });
  });

  it("replaces the text of exactly that note", async () => {
    const { prisma, repository } = prismaDouble();

    await repository.update(ID, "APK documenten nakijken");

    expect(prisma.note.update).toHaveBeenCalledWith({
      where: { id: ID },
      data: { content: "APK documenten nakijken" },
    });
  });

  it("deletes physically, and says whether anything was there", async () => {
    await expect(prismaDouble().repository.delete(ID)).resolves.toBe(true);
    await expect(prismaDouble(0).repository.delete(ID)).resolves.toBe(false);
  });
});
