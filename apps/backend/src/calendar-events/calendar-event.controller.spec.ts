import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { CalendarEvent } from "@prisma/client";
import request from "supertest";

import { toUtcDate } from "../common/dates";
import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { ResponseInterceptor } from "../common/interceptors/response.interceptor";
import { toUtcTime } from "../common/time-of-day";
import { AppLoggerService } from "../logger/app-logger.service";
import { CalendarEventController } from "./calendar-event.controller";
import { CalendarEventRepository } from "./calendar-event.repository";
import { CalendarEventService } from "./calendar-event.service";

const EVENT_ID = "7b1f4c2e-2d7a-4a55-9a51-0f3c2f1f9d10";
const DAY = "2026-09-14";
const BASE = "/api/v1/calendar-events";

function row(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: EVENT_ID,
    title: "Vergadering",
    description: null,
    eventType: "OTHER",
    startDate: toUtcDate(DAY),
    startTime: toUtcTime("10:00"),
    endDate: null,
    endTime: toUtcTime("11:00"),
    color: null,
    createdAt: new Date("2026-09-13T08:00:00.000Z"),
    updatedAt: new Date("2026-09-13T08:00:00.000Z"),
    ...overrides,
  };
}

/**
 * The Agenda over HTTP: real routing, the global ValidationPipe, the response
 * envelope and the exception filter. Only the repository is stubbed — what it
 * is asked to store is the assertion.
 */
describe("CalendarEventController (integration)", () => {
  let app: INestApplication;
  let repository: {
    findForDay: jest.Mock;
    findById: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };

  beforeEach(async () => {
    repository = {
      findForDay: jest.fn().mockResolvedValue([]),
      findById: jest.fn().mockResolvedValue(row()),
      create: jest.fn((data: object) =>
        Promise.resolve(row(data as Partial<CalendarEvent>)),
      ),
      update: jest.fn((_id: string, data: object) =>
        Promise.resolve(row(data as Partial<CalendarEvent>)),
      ),
      delete: jest.fn().mockResolvedValue(true),
    };

    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [CalendarEventController],
      providers: [
        CalendarEventService,
        { provide: CalendarEventRepository, useValue: repository },
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

  function create(body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post(BASE)
      .send({ title: "Vergadering", date: DAY, startTime: "10:00", ...body });
  }

  function patch(body: Record<string, unknown>) {
    return request(app.getHttpServer()).patch(`${BASE}/${EVENT_ID}`).send(body);
  }

  /** What the repository was asked to store. */
  function stored(mock: jest.Mock, argument = 0): Record<string, unknown> {
    return mock.mock.calls[0][argument] as Record<string, unknown>;
  }

  describe("one day", () => {
    it("answers the day's items with the hours the Agenda shows", async () => {
      repository.findForDay.mockResolvedValue([
        row(),
        row({
          id: "0d6c2d0a-1d47-4d7c-8a11-5a1a8a3c2b99",
          title: "Telefoon",
          startTime: toUtcTime("10:30"),
          endTime: toUtcTime("12:00"),
        }),
      ]);

      const response = await request(app.getHttpServer())
        .get(BASE)
        .query({ date: DAY })
        .expect(200);

      expect(response.body.data).toEqual({
        date: DAY,
        dayStart: "06:00",
        dayEnd: "23:00",
        items: [
          expect.objectContaining({
            title: "Vergadering",
            date: DAY,
            startTime: "10:00:00",
            endTime: "11:00:00",
          }),
          expect.objectContaining({
            title: "Telefoon",
            startTime: "10:30:00",
            endTime: "12:00:00",
          }),
        ],
      });
    });

    it("asks the repository for exactly that day", async () => {
      await request(app.getHttpServer()).get(BASE).query({ date: DAY }).expect(200);

      expect(repository.findForDay).toHaveBeenCalledWith(toUtcDate(DAY));
    });

    it.each([
      ["no date", {}],
      ["an impossible date", { date: "2026-02-30" }],
      ["a timestamp", { date: "2026-09-14T10:00:00Z" }],
    ])("refuses %s", async (_case, query) => {
      await request(app.getHttpServer()).get(BASE).query(query).expect(400);

      expect(repository.findForDay).not.toHaveBeenCalled();
    });
  });

  describe("creating", () => {
    it("gives an item without an end exactly one hour", async () => {
      const response = await create({}).expect(201);

      expect(stored(repository.create)).toMatchObject({
        startTime: toUtcTime("10:00"),
        endTime: toUtcTime("11:00"),
      });
      expect(response.body.data).toMatchObject({
        startTime: "10:00:00",
        endTime: "11:00:00",
      });
    });

    it("treats a null end as no end", async () => {
      await create({ endTime: null }).expect(201);

      expect(stored(repository.create)).toMatchObject({
        endTime: toUtcTime("11:00"),
      });
    });

    it("keeps the end that was given", async () => {
      const response = await create({ startTime: "10:30", endTime: "12:00" }).expect(201);

      expect(stored(repository.create)).toMatchObject({
        startTime: toUtcTime("10:30"),
        endTime: toUtcTime("12:00"),
      });
      expect(response.body.data).toMatchObject({
        startTime: "10:30:00",
        endTime: "12:00:00",
      });
    });

    /** One DATE and two TIMEs, stored as given: a single-day item with no event type to choose. */
    it("stores the day and the wall-clock times exactly", async () => {
      await create({ title: "  Vergadering  ", startTime: "07:00", endTime: "08:15" }).expect(201);

      expect(stored(repository.create)).toEqual({
        title: "Vergadering",
        eventType: "OTHER",
        startDate: new Date("2026-09-14T00:00:00.000Z"),
        startTime: new Date("1970-01-01T07:00:00.000Z"),
        endDate: null,
        endTime: new Date("1970-01-01T08:15:00.000Z"),
      });
    });

    it("drops seconds", async () => {
      await create({ startTime: "10:00:45", endTime: "10:30:10" }).expect(201);

      expect(stored(repository.create)).toMatchObject({
        startTime: toUtcTime("10:00"),
        endTime: toUtcTime("10:30"),
      });
    });

    it.each([
      ["no title", { title: undefined }],
      ["an empty title", { title: "" }],
      ["a title of spaces", { title: "   " }],
      ["a title that is not text", { title: 42 }],
      ["an over-long title", { title: "x".repeat(201) }],
      ["no day", { date: undefined }],
      ["an impossible day", { date: "2026-13-01" }],
      ["no start", { startTime: undefined }],
      ["an impossible start", { startTime: "25:00" }],
      ["an impossible end", { endTime: "10:61" }],
      ["an event type", { eventType: "MEETING" }],
    ])("refuses %s", async (_case, body) => {
      await create(body).expect(400);

      expect(repository.create).not.toHaveBeenCalled();
    });

    it.each([
      ["at the start", "10:00"],
      ["before the start", "09:30"],
    ])("refuses an end %s", async (_case, endTime) => {
      const response = await create({ endTime }).expect(400);

      expect(response.body.error.message).toMatch(/must be after the start time/);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it.each([
      ["a start before 06:00", { startTime: "05:00" }],
      ["an end after 23:00", { startTime: "22:00", endTime: "23:30" }],
      ["a default hour running past 23:00", { startTime: "22:30" }],
    ])("refuses %s", async (_case, body) => {
      const response = await create(body).expect(400);

      expect(response.body.error.message).toMatch(/between 06:00 and 23:00/);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it("accepts the day's last hour", async () => {
      await create({ startTime: "22:00" }).expect(201);

      expect(stored(repository.create)).toMatchObject({
        endTime: toUtcTime("23:00"),
      });
    });
  });

  describe("editing", () => {
    it("changes the title and keeps the times", async () => {
      await patch({ title: "Vergadering met klant" }).expect(200);

      expect(stored(repository.update, 1)).toEqual({
        title: "Vergadering met klant",
        startTime: toUtcTime("10:00"),
        endTime: toUtcTime("11:00"),
      });
    });

    it("moves the start and keeps the end", async () => {
      const response = await patch({ startTime: "10:30" }).expect(200);

      expect(stored(repository.update, 1)).toMatchObject({
        startTime: toUtcTime("10:30"),
        endTime: toUtcTime("11:00"),
      });
      expect(response.body.data).toMatchObject({
        startTime: "10:30:00",
        endTime: "11:00:00",
      });
    });

    it("changes the end", async () => {
      await patch({ endTime: "12:00" }).expect(200);

      expect(stored(repository.update, 1)).toMatchObject({
        startTime: toUtcTime("10:00"),
        endTime: toUtcTime("12:00"),
      });
    });

    it("gives a cleared end one hour after the start", async () => {
      await patch({ startTime: "14:00", endTime: null }).expect(200);

      expect(stored(repository.update, 1)).toMatchObject({
        startTime: toUtcTime("14:00"),
        endTime: toUtcTime("15:00"),
      });
    });

    /** The day is not editable: the item stays where it was. */
    it("keeps the item on its day", async () => {
      await patch({ startTime: "08:00", endTime: "09:00" }).expect(200);

      expect(stored(repository.update, 1)).not.toHaveProperty("startDate");
      expect(stored(repository.update, 1)).not.toHaveProperty("endDate");
    });

    it("refuses a new day", async () => {
      await patch({ date: "2026-09-15" }).expect(400);

      expect(repository.update).not.toHaveBeenCalled();
    });

    it("refuses a start moved past the stored end", async () => {
      await patch({ startTime: "11:30" }).expect(400);

      expect(repository.update).not.toHaveBeenCalled();
    });

    it("refuses an end moved before the start", async () => {
      await patch({ endTime: "09:00" }).expect(400);

      expect(repository.update).not.toHaveBeenCalled();
    });

    it("refuses an item moved outside the Agenda's day", async () => {
      await patch({ startTime: "22:30", endTime: "23:30" }).expect(400);

      expect(repository.update).not.toHaveBeenCalled();
    });

    it.each([
      ["an empty title", { title: "" }],
      ["a null title", { title: null }],
      ["a null start", { startTime: null }],
    ])("refuses %s", async (_case, body) => {
      await patch(body).expect(400);

      expect(repository.update).not.toHaveBeenCalled();
    });

    it("reports an unknown item as 404", async () => {
      repository.findById.mockResolvedValue(null);

      await patch({ title: "Nieuw" }).expect(404);
    });
  });

  describe("deleting", () => {
    it("removes the item and answers with it", async () => {
      const response = await request(app.getHttpServer())
        .delete(`${BASE}/${EVENT_ID}`)
        .expect(200);

      expect(repository.delete).toHaveBeenCalledWith(EVENT_ID);
      expect(response.body.data).toMatchObject({ id: EVENT_ID, title: "Vergadering" });
    });

    it("reports an unknown item as 404 and removes nothing", async () => {
      repository.findById.mockResolvedValue(null);

      await request(app.getHttpServer()).delete(`${BASE}/${EVENT_ID}`).expect(404);

      expect(repository.delete).not.toHaveBeenCalled();
    });

    it("reports an item deleted in the meantime as 404", async () => {
      repository.delete.mockResolvedValue(false);

      await request(app.getHttpServer()).delete(`${BASE}/${EVENT_ID}`).expect(404);
    });

    it("refuses an id that is not a UUID", async () => {
      await request(app.getHttpServer()).delete(`${BASE}/not-an-id`).expect(400);
    });
  });

  describe("reading one", () => {
    it("answers the item", async () => {
      const response = await request(app.getHttpServer())
        .get(`${BASE}/${EVENT_ID}`)
        .expect(200);

      expect(response.body.data).toMatchObject({
        id: EVENT_ID,
        date: DAY,
        startTime: "10:00:00",
        endTime: "11:00:00",
      });
    });

    it("reports an unknown item as 404", async () => {
      repository.findById.mockResolvedValue(null);

      await request(app.getHttpServer()).get(`${BASE}/${EVENT_ID}`).expect(404);
    });
  });

  /**
   * Nothing is converted through a local time, so the server's zone cannot move
   * an item to another day or hour. Jest cannot switch the process's zone from
   * inside a test; this pins the exact UTC-anchored values, which any local-time
   * conversion breaks on a machine outside UTC. Run the file with TZ set to
   * check another zone.
   */
  it("stores and answers 14/09 07:00–08:00 without moving it", async () => {
    repository.findForDay.mockResolvedValue([
      row({ startTime: toUtcTime("07:00"), endTime: toUtcTime("08:00") }),
    ]);

    await create({ startTime: "07:00" }).expect(201);
    const day = await request(app.getHttpServer())
      .get(BASE)
      .query({ date: DAY })
      .expect(200);

    expect(stored(repository.create)).toMatchObject({
      startDate: new Date("2026-09-14T00:00:00.000Z"),
      startTime: new Date("1970-01-01T07:00:00.000Z"),
      endTime: new Date("1970-01-01T08:00:00.000Z"),
    });
    expect(day.body.data.items[0]).toMatchObject({
      date: DAY,
      startTime: "07:00:00",
      endTime: "08:00:00",
    });
  });
});
