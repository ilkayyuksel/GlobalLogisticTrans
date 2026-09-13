import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { Note } from "@prisma/client";
import request from "supertest";

import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { ResponseInterceptor } from "../common/interceptors/response.interceptor";
import { AppLoggerService } from "../logger/app-logger.service";
import { NOTE_CONTENT_MAX_LENGTH } from "./dto/create-note.dto";
import { NoteController } from "./note.controller";
import { NoteRepository } from "./note.repository";
import { NoteService } from "./note.service";

const BASE = "/api/v1/notes";
const FIRST_ID = "5d2f0b8e-7a1c-4c3e-9b2d-1f6e8a4c3b21";
const UNKNOWN_ID = "0b6f3a8e-1c2d-4e5f-8a9b-7c6d5e4f3a2b";

/**
 * A repository that keeps what it is given, so a note created over HTTP is in
 * the next list — the persistence a page refresh relies on, as far as it can
 * be shown without a database. Every method is a spy, so what was stored is
 * asserted too.
 */
function inMemoryRepository() {
  let notes: Note[] = [];
  let clock = Date.parse("2026-09-13T08:00:00.000Z");
  let sequence = 0;
  const tick = () => new Date((clock += 60_000));

  return {
    seed(...seeded: Note[]) {
      notes = [...seeded];
    },
    findAll: jest.fn(async () =>
      [...notes].sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime()),
    ),
    findById: jest.fn(async (id: string) => notes.find((note) => note.id === id) ?? null),
    create: jest.fn(async (content: string) => {
      sequence += 1;
      const now = tick();
      const created: Note = {
        id: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
        content,
        createdAt: now,
        updatedAt: now,
      };

      notes.push(created);

      return created;
    }),
    update: jest.fn(async (id: string, content: string) => {
      const index = notes.findIndex((note) => note.id === id);

      notes[index] = { ...notes[index], content, updatedAt: tick() };

      return notes[index];
    }),
    delete: jest.fn(async (id: string) => {
      const before = notes.length;

      notes = notes.filter((note) => note.id !== id);

      return notes.length < before;
    }),
  };
}

function note(id: string, content: string, minute: number): Note {
  const at = new Date(Date.UTC(2026, 8, 13, 7, minute));

  return { id, content, createdAt: at, updatedAt: at };
}

/**
 * Notes over HTTP: real routing, the global ValidationPipe, the response
 * envelope and the exception filter. Only the repository is replaced.
 */
describe("NoteController (integration)", () => {
  let app: INestApplication;
  let repository: ReturnType<typeof inMemoryRepository>;

  beforeEach(async () => {
    repository = inMemoryRepository();

    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [NoteController],
      providers: [
        NoteService,
        { provide: NoteRepository, useValue: repository },
        { provide: AppLoggerService, useValue: logger },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
      ],
    })
      .overrideProvider(AppLoggerService)
      .useValue(logger)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );

    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const list = () => request(app.getHttpServer()).get(BASE).expect(200);
  const create = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post(BASE).send(body);
  const patch = (id: string, body: Record<string, unknown>) =>
    request(app.getHttpServer()).patch(`${BASE}/${id}`).send(body);
  const remove = (id: string) => request(app.getHttpServer()).delete(`${BASE}/${id}`);

  /** The texts of the current list, in the order the API answers them. */
  async function listedTexts(): Promise<string[]> {
    const response = await list();

    return response.body.data.map((item: { content: string }) => item.content);
  }

  describe("listing", () => {
    it("answers an empty list when there are no notes", async () => {
      expect((await list()).body.data).toEqual([]);
    });

    it("answers every note, the most recently changed first", async () => {
      repository.seed(
        note(FIRST_ID, "Reserve chauffeur bellen", 0),
        note(UNKNOWN_ID.replace("0b6", "1b6"), "APK documenten nakijken", 5),
      );

      const response = await list();

      expect(response.body.data).toEqual([
        expect.objectContaining({ content: "APK documenten nakijken" }),
        expect.objectContaining({ id: FIRST_ID, content: "Reserve chauffeur bellen" }),
      ]);
      expect(Object.keys(response.body.data[0]).sort()).toEqual([
        "content",
        "createdAt",
        "id",
        "updatedAt",
      ]);
    });
  });

  describe("adding", () => {
    it("stores the text and answers the note", async () => {
      const response = await create({ content: "Reserve chauffeur bellen" }).expect(201);

      expect(repository.create).toHaveBeenCalledWith("Reserve chauffeur bellen");
      expect(response.body.data).toMatchObject({ content: "Reserve chauffeur bellen" });
    });

    it("keeps line breaks and removes only the surrounding whitespace", async () => {
      await create({ content: "  \nBellen:\n- Jan\n- Piet\n\n  " }).expect(201);

      expect(repository.create).toHaveBeenCalledWith("Bellen:\n- Jan\n- Piet");
    });

    it("keeps what was added: it is in every later list", async () => {
      await create({ content: "Reserve chauffeur bellen" }).expect(201);

      expect(await listedTexts()).toEqual(["Reserve chauffeur bellen"]);
      expect(await listedTexts()).toEqual(["Reserve chauffeur bellen"]);
    });

    it("keeps several notes apart", async () => {
      await create({ content: "Reserve chauffeur bellen" }).expect(201);
      await create({ content: "APK documenten nakijken" }).expect(201);

      expect(await listedTexts()).toEqual([
        "APK documenten nakijken",
        "Reserve chauffeur bellen",
      ]);
    });

    it("accepts text of exactly the maximum length", async () => {
      await create({ content: "x".repeat(NOTE_CONTENT_MAX_LENGTH) }).expect(201);
    });

    it.each([
      ["no text", {}],
      ["empty text", { content: "" }],
      ["only spaces", { content: "   " }],
      ["only blank lines and tabs", { content: "\n\t \n" }],
      ["a null text", { content: null }],
      ["text that is not text", { content: 42 }],
      ["text that is too long", { content: "x".repeat(NOTE_CONTENT_MAX_LENGTH + 1) }],
      ["a title", { content: "Bellen", title: "Taak" }],
      ["a colour", { content: "Bellen", color: "#ff0000" }],
    ])("refuses %s", async (_case, body) => {
      await create(body).expect(400);

      expect(repository.create).not.toHaveBeenCalled();
      expect(await listedTexts()).toEqual([]);
    });
  });

  describe("changing", () => {
    beforeEach(() => {
      repository.seed(note(FIRST_ID, "Reserve chauffeur bellen", 0));
    });

    it("replaces the text", async () => {
      const response = await patch(FIRST_ID, { content: "APK documenten nakijken" }).expect(200);

      expect(repository.update).toHaveBeenCalledWith(FIRST_ID, "APK documenten nakijken");
      expect(response.body.data).toMatchObject({
        id: FIRST_ID,
        content: "APK documenten nakijken",
      });
      expect(await listedTexts()).toEqual(["APK documenten nakijken"]);
    });

    it.each([
      ["empty text", { content: "" }],
      ["only whitespace", { content: " \n " }],
      ["no text", {}],
      ["an unknown field", { content: "Bellen", title: "Taak" }],
    ])("refuses %s and keeps the note as it was", async (_case, body) => {
      await patch(FIRST_ID, body).expect(400);

      expect(repository.update).not.toHaveBeenCalled();
      expect(await listedTexts()).toEqual(["Reserve chauffeur bellen"]);
    });

    it("reports an unknown note as 404", async () => {
      await patch(UNKNOWN_ID, { content: "Bellen" }).expect(404);

      expect(repository.update).not.toHaveBeenCalled();
    });

    it("refuses an id that is not a UUID", async () => {
      await patch("not-an-id", { content: "Bellen" }).expect(400);
    });
  });

  describe("deleting", () => {
    beforeEach(() => {
      repository.seed(
        note(FIRST_ID, "Reserve chauffeur bellen", 0),
        note(UNKNOWN_ID.replace("0b6", "1b6"), "APK documenten nakijken", 5),
      );
    });

    it("removes the note, answers with it, and leaves the others", async () => {
      const response = await remove(FIRST_ID).expect(200);

      expect(response.body.data).toMatchObject({
        id: FIRST_ID,
        content: "Reserve chauffeur bellen",
      });
      expect(await listedTexts()).toEqual(["APK documenten nakijken"]);
    });

    it("reports an unknown note as 404 and removes nothing", async () => {
      await remove(UNKNOWN_ID).expect(404);

      expect(repository.delete).not.toHaveBeenCalled();
      expect(await listedTexts()).toHaveLength(2);
    });

    it("reports a note deleted in the meantime as 404", async () => {
      repository.delete.mockResolvedValueOnce(false);

      await remove(FIRST_ID).expect(404);
    });

    it("refuses an id that is not a UUID", async () => {
      await remove("not-an-id").expect(400);
    });
  });
});
