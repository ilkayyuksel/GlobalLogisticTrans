import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import CalendarPage from "./page";
import { ApiError, request } from "@/lib/api/client";
import type { CalendarEvent } from "@/lib/api/calendar-events";
import { LanguageProvider } from "@/lib/i18n/language-provider";
import { ThemeProvider } from "@/lib/theme/theme-provider";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

jest.mock("@/lib/calendar/calendar-dates", () => ({
  ...jest.requireActual("@/lib/calendar/calendar-dates"),
  today: () => "2026-09-14",
}));

let mockSearchParams = new URLSearchParams();

jest.mock("next/navigation", () => ({
  ...jest.requireActual("next/navigation"),
  useSearchParams: () => mockSearchParams,
}));

const requestMock = request as jest.MockedFunction<typeof request>;
/** A Monday: the week shown first is 14–20 September 2026. */
const TODAY = "2026-09-14";
const TUESDAY_ISO = "2026-09-15";
const PATH = "/api/v1/calendar-events";
/** One hour of the 06:00–23:00 day, as a percentage of its height. */
const HOUR = 100 / 17;
const MONDAY = "Maandag 14 september";
const TUESDAY = "Dinsdag 15 september";
const WEDNESDAY = "Woensdag 16 september";
const THURSDAY = "Donderdag 17 september";

/** Every browser API Jest fakes except the clock, so the page's own timers still run. */
const ALL_BUT_DATE = [
  "hrtime",
  "nextTick",
  "performance",
  "queueMicrotask",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "requestIdleCallback",
  "cancelIdleCallback",
  "setImmediate",
  "clearImmediate",
  "setInterval",
  "clearInterval",
  "setTimeout",
  "clearTimeout",
] as const;

type Init = {
  method?: string;
  query?: { from?: string; to?: string };
  body?: Record<string, string | null | undefined>;
};

/** The fake backend's store, every day at once. */
let items: CalendarEvent[];
/** When set, the next write fails the way the backend would refuse it. */
let refusal: ApiError | null;
let createdCount: number;

function event(
  id: string,
  title: string,
  date: string,
  start: string,
  end: string,
): CalendarEvent {
  return {
    id,
    title,
    date,
    startTime: `${start}:00`,
    endTime: `${end}:00`,
    createdAt: "2026-09-13T08:00:00.000Z",
    updatedAt: "2026-09-13T08:00:00.000Z",
  };
}

/** The backend's rule for an item without an end, proved in its own specs; mirrored by the fake. */
function oneHourAfter(start: string): string {
  const [hours, minutes] = start.split(":").map(Number);

  return `${String(hours + 1).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function fakeBackend(path: string, init: Init = {}): Promise<unknown> {
  const method = init.method ?? "GET";

  if (method === "GET" && path === PATH) {
    const from = init.query?.from ?? "";
    const to = init.query?.to ?? "";
    const inRange = items
      .filter((item) => item.date >= from && item.date <= to)
      .sort((left, right) =>
        `${left.date}${left.startTime}`.localeCompare(`${right.date}${right.startTime}`),
      );

    return Promise.resolve({ from, to, dayStart: "06:00", dayEnd: "23:00", items: inRange });
  }

  if (refusal) {
    return Promise.reject(refusal);
  }

  const body = init.body ?? {};

  if (method === "POST") {
    createdCount += 1;

    const start = String(body.startTime);
    const created = event(
      `new-${createdCount}`,
      String(body.title),
      String(body.date),
      start,
      body.endTime ?? oneHourAfter(start),
    );

    items.push(created);

    return Promise.resolve(created);
  }

  const id = path.slice(PATH.length + 1);
  const index = items.findIndex((item) => item.id === id);

  if (index === -1) {
    return Promise.reject(new ApiError("NOT_FOUND", "No such Agenda item.", 404));
  }

  if (method === "PATCH") {
    const found = items[index];
    const start = body.startTime ?? found.startTime.slice(0, 5);
    const end =
      body.endTime === null ? oneHourAfter(start) : (body.endTime ?? found.endTime.slice(0, 5));

    items[index] = {
      ...found,
      title: body.title ?? found.title,
      date: body.date ?? found.date,
      startTime: `${start}:00`,
      endTime: `${end}:00`,
    };

    return Promise.resolve(items[index]);
  }

  const [removed] = items.splice(index, 1);

  return Promise.resolve(removed);
}

function writes(method: "POST" | "PATCH" | "DELETE") {
  return requestMock.mock.calls.filter(
    ([, init]) => (init as Init | undefined)?.method === method,
  );
}

/** Every range the page asked for, as "from..to". */
function weekRequests(): string[] {
  return requestMock.mock.calls
    .filter(([path, init]) => path === PATH && !(init as Init | undefined)?.method)
    .map(([, init]) => `${(init as Init).query?.from}..${(init as Init).query?.to}`);
}

function renderAgenda(): Promise<HTMLElement> {
  render(
    <ThemeProvider>
      <LanguageProvider>
        <CalendarPage />
      </LanguageProvider>
    </ThemeProvider>,
  );

  return screen.findByRole("group", { name: "Weekagenda" });
}

/** One day's column. */
function day(name: string): HTMLElement {
  return screen.getByRole("group", { name });
}

async function clickSlot(dayName: string, time: string): Promise<HTMLElement> {
  await userEvent.click(
    await screen.findByRole("button", { name: `Nieuw agenda-item — ${dayName}, ${time}` }),
  );

  return screen.findByRole("dialog", { name: "Nieuw agenda-item" });
}

/** The positioned block around an item's button. */
async function blockOf(name: string): Promise<HTMLElement> {
  return (await screen.findByRole("button", { name })).parentElement as HTMLElement;
}

function setField(dialog: HTMLElement, label: string, value: string): void {
  fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });
}

async function save(dialog: HTMLElement): Promise<void> {
  await userEvent.click(within(dialog).getByRole("button", { name: "Opslaan" }));
}

describe("the Agenda, a week calendar", () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockImplementation((...args: unknown[]) =>
      fakeBackend(args[0] as string, args[1] as Init | undefined),
    );
    items = [];
    refusal = null;
    createdCount = 0;
    mockSearchParams = new URLSearchParams();
    window.localStorage.clear();
  });

  describe("the week", () => {
    it("opens on the current week, Monday to Sunday, asked of the backend at once", async () => {
      await renderAgenda();

      expect(weekRequests()).toEqual(["2026-09-14..2026-09-20"]);
      expect(screen.getByText("14 – 20 september 2026")).toBeInTheDocument();

      for (const name of [
        MONDAY,
        TUESDAY,
        WEDNESDAY,
        THURSDAY,
        "Vrijdag 18 september",
        "Zaterdag 19 september",
        "Zondag 20 september",
      ]) {
        expect(day(name)).toBeInTheDocument();
      }
    });

    it("gives every day an hour block from 06:00 to 22:00, the last ending at 23:00", async () => {
      const week = await renderAgenda();

      expect(
        within(day(WEDNESDAY)).getAllByRole("button", { name: /^Nieuw agenda-item/ }),
      ).toHaveLength(17);
      expect(
        within(week).getAllByRole("button", { name: /^Nieuw agenda-item/ }),
      ).toHaveLength(7 * 17);
      expect(
        screen.getByRole("button", { name: `Nieuw agenda-item — ${MONDAY}, 06:00` }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: `Nieuw agenda-item — ${MONDAY}, 22:00` }),
      ).toBeInTheDocument();
      expect(within(week).getByText("06:00")).toBeInTheDocument();
      expect(within(week).getByText("23:00")).toBeInTheDocument();
    });

    it("marks today, and only today", async () => {
      await renderAgenda();

      expect(day(MONDAY)).toHaveAttribute("aria-current", "date");
      expect(day(TUESDAY)).not.toHaveAttribute("aria-current");
    });

    it("moves to the next and previous week, and back to this week", async () => {
      await renderAgenda();

      await userEvent.click(screen.getByRole("button", { name: "Volgende" }));
      expect(await screen.findByText("21 – 27 september 2026")).toBeInTheDocument();
      expect(day("Maandag 21 september")).not.toHaveAttribute("aria-current");

      await userEvent.click(screen.getByRole("button", { name: "Vorige" }));
      await userEvent.click(screen.getByRole("button", { name: "Vorige" }));
      expect(await screen.findByText("7 – 13 september 2026")).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Deze week" }));
      expect(await screen.findByText("14 – 20 september 2026")).toBeInTheDocument();

      expect(weekRequests()).toEqual([
        "2026-09-14..2026-09-20",
        "2026-09-21..2026-09-27",
        "2026-09-14..2026-09-20",
        "2026-09-07..2026-09-13",
        "2026-09-14..2026-09-20",
      ]);
    });

    it("keeps its date boundaries across a month", async () => {
      mockSearchParams = new URLSearchParams("date=2026-10-01");
      await renderAgenda();

      expect(weekRequests()).toEqual(["2026-09-28..2026-10-04"]);
      expect(screen.getByText("28 september – 4 oktober 2026")).toBeInTheDocument();
      expect(day("Woensdag 30 september")).toBeInTheDocument();
      expect(day("Donderdag 1 oktober")).toBeInTheDocument();
    });

    it("keeps seven days across the end of summer time", async () => {
      mockSearchParams = new URLSearchParams("date=2026-10-25");
      await renderAgenda();

      expect(weekRequests()).toEqual(["2026-10-19..2026-10-25"]);
      expect(day("Maandag 19 oktober")).toBeInTheDocument();
      expect(day("Zondag 25 oktober")).toBeInTheDocument();
    });

    it("shows each item on its own day only", async () => {
      items = [
        event("a", "Vergadering", TODAY, "10:00", "11:00"),
        event("b", "Keuring", "2026-09-16", "14:00", "15:00"),
        event("c", "Volgende week", "2026-09-21", "10:00", "11:00"),
      ];
      await renderAgenda();

      const monday = day(MONDAY);

      expect(
        await within(monday).findByRole("button", { name: "Vergadering, 10:00–11:00" }),
      ).toBeInTheDocument();
      expect(within(monday).queryByText("Keuring")).not.toBeInTheDocument();
      expect(
        within(day(WEDNESDAY)).getByRole("button", { name: "Keuring, 14:00–15:00" }),
      ).toBeInTheDocument();
      expect(screen.queryByText("Volgende week")).not.toBeInTheDocument();
    });
  });

  describe("adding an item", () => {
    it("clicking Monday 08:00 adds an item on Monday at 08:00", async () => {
      await renderAgenda();
      const dialog = await clickSlot(MONDAY, "08:00");

      expect(within(dialog).getByText("Maandag 14 september 2026")).toBeInTheDocument();
      expect(within(dialog).getByLabelText("Starttijd")).toHaveValue("08:00");

      await userEvent.type(within(dialog).getByLabelText("Titel"), "Overleg");
      await save(dialog);

      await waitFor(() => expect(writes("POST")).toHaveLength(1));
      expect(writes("POST")[0]).toEqual([
        PATH,
        expect.objectContaining({
          method: "POST",
          body: { title: "Overleg", date: TODAY, startTime: "08:00" },
        }),
      ]);
      expect(
        await within(day(MONDAY)).findByRole("button", { name: "Overleg, 08:00–09:00" }),
      ).toBeInTheDocument();
      expect(screen.getByText("Agenda-item toegevoegd.")).toBeInTheDocument();
    });

    it("clicking Wednesday 14:00 adds an item on Wednesday at 14:00", async () => {
      await renderAgenda();
      const dialog = await clickSlot(WEDNESDAY, "14:00");

      await userEvent.type(within(dialog).getByLabelText("Titel"), "Telefoon");
      await save(dialog);

      await waitFor(() => expect(writes("POST")).toHaveLength(1));
      expect(writes("POST")[0][1]).toMatchObject({
        body: { title: "Telefoon", date: "2026-09-16", startTime: "14:00" },
      });
      expect(
        await within(day(WEDNESDAY)).findByRole("button", { name: "Telefoon, 14:00–15:00" }),
      ).toBeInTheDocument();
      expect(within(day(MONDAY)).queryByText("Telefoon")).not.toBeInTheDocument();
    });

    it("draws an item without an end exactly one hour tall", async () => {
      await renderAgenda();
      const dialog = await clickSlot(MONDAY, "10:00");

      await userEvent.type(within(dialog).getByLabelText("Titel"), "Vergadering");
      await save(dialog);

      const block = await blockOf("Vergadering, 10:00–11:00");

      expect(parseFloat(block.style.top)).toBeCloseTo(4 * HOUR, 3);
      expect(parseFloat(block.style.height)).toBeCloseTo(HOUR, 3);
    });

    it("sends the end that was chosen and draws its duration", async () => {
      await renderAgenda();
      const dialog = await clickSlot(MONDAY, "14:00");

      await userEvent.type(within(dialog).getByLabelText("Titel"), "Werkoverleg");
      setField(dialog, "Eindtijd", "16:00");
      await save(dialog);

      await waitFor(() => expect(writes("POST")).toHaveLength(1));
      expect(writes("POST")[0][1]).toMatchObject({
        body: { title: "Werkoverleg", date: TODAY, startTime: "14:00", endTime: "16:00" },
      });
      expect(parseFloat((await blockOf("Werkoverleg, 14:00–16:00")).style.height)).toBeCloseTo(
        2 * HOUR,
        3,
      );
    });

    it("lets the clicked start be adjusted, to 10:30 say", async () => {
      await renderAgenda();
      const dialog = await clickSlot(MONDAY, "10:00");

      await userEvent.type(within(dialog).getByLabelText("Titel"), "Telefoon");
      setField(dialog, "Starttijd", "10:30");
      setField(dialog, "Eindtijd", "12:00");
      await save(dialog);

      await waitFor(() => expect(writes("POST")).toHaveLength(1));
      expect(writes("POST")[0][1]).toMatchObject({
        body: { date: TODAY, startTime: "10:30", endTime: "12:00" },
      });
    });

    it("requires a title", async () => {
      await renderAgenda();
      const dialog = await clickSlot(MONDAY, "10:00");

      await userEvent.type(within(dialog).getByLabelText("Titel"), "   ");
      await save(dialog);

      expect(within(dialog).getByRole("alert")).toHaveTextContent("Vul een titel in.");
      expect(writes("POST")).toHaveLength(0);
    });

    it.each(["09:30", "10:00"])("refuses an end of %s for a 10:00 start", async (end) => {
      await renderAgenda();
      const dialog = await clickSlot(MONDAY, "10:00");

      await userEvent.type(within(dialog).getByLabelText("Titel"), "Vergadering");
      setField(dialog, "Eindtijd", end);
      await save(dialog);

      expect(within(dialog).getByRole("alert")).toHaveTextContent(
        "De eindtijd moet na de starttijd liggen.",
      );
      expect(writes("POST")).toHaveLength(0);
    });

    it("shows the backend's refusal and keeps what was typed", async () => {
      refusal = new ApiError(
        "BAD_REQUEST",
        "An Agenda item must lie between 06:00 and 23:00; 22:00–23:30 does not.",
        400,
      );
      await renderAgenda();
      const dialog = await clickSlot(MONDAY, "22:00");

      await userEvent.type(within(dialog).getByLabelText("Titel"), "Laat");
      setField(dialog, "Eindtijd", "23:30");
      await save(dialog);

      expect(await within(dialog).findByRole("alert")).toHaveTextContent(
        /between 06:00 and 23:00/,
      );
      expect(within(dialog).getByLabelText("Titel")).toHaveValue("Laat");
    });

    it("sends nothing when cancelled", async () => {
      await renderAgenda();
      const dialog = await clickSlot(MONDAY, "10:00");

      await userEvent.type(within(dialog).getByLabelText("Titel"), "Vergadering");
      await userEvent.click(within(dialog).getByRole("button", { name: "Annuleren" }));

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(writes("POST")).toHaveLength(0);
    });
  });

  describe("durations and overlap", () => {
    it("draws a 30-minute item half as tall, and a 2-hour item twice as tall, as an hour", async () => {
      items = [
        event("h", "Half uur", TODAY, "08:00", "08:30"),
        event("u", "Uur", TUESDAY_ISO, "08:00", "09:00"),
        event("t", "Twee uur", "2026-09-16", "08:00", "10:00"),
      ];
      await renderAgenda();

      const half = parseFloat((await blockOf("Half uur, 08:00–08:30")).style.height);
      const hour = parseFloat((await blockOf("Uur, 08:00–09:00")).style.height);
      const two = parseFloat((await blockOf("Twee uur, 08:00–10:00")).style.height);

      expect(half).toBeCloseTo(hour / 2, 3);
      expect(two).toBeCloseTo(hour * 2, 3);
    });

    it("stands 10:00–11:00 and 10:30–12:00 side by side", async () => {
      items = [
        event("a", "Vergadering", TODAY, "10:00", "11:00"),
        event("b", "Telefoon", TODAY, "10:30", "12:00"),
      ];
      await renderAgenda();

      const first = await blockOf("Vergadering, 10:00–11:00");
      const second = await blockOf("Telefoon, 10:30–12:00");

      expect([first.style.left, first.style.width]).toEqual(["0%", "50%"]);
      expect([second.style.left, second.style.width]).toEqual(["50%", "50%"]);
    });

    it("divides the width in three for three items at the same time", async () => {
      items = [
        event("a", "Item A", TODAY, "10:00", "11:00"),
        event("b", "Item B", TODAY, "10:00", "11:00"),
        event("c", "Item C", TODAY, "10:00", "11:00"),
      ];
      await renderAgenda();

      const lefts = await Promise.all(
        ["Item A", "Item B", "Item C"].map(async (title) =>
          (await blockOf(`${title}, 10:00–11:00`)).style.left,
        ),
      );

      expect(new Set(lefts).size).toBe(3);
    });

    it("keeps items that only meet at the whole width", async () => {
      items = [
        event("a", "Vergadering", TODAY, "10:00", "11:00"),
        event("b", "Telefoon", TODAY, "11:00", "12:00"),
      ];
      await renderAgenda();

      expect((await blockOf("Vergadering, 10:00–11:00")).style.width).toBe("100%");
      expect((await blockOf("Telefoon, 11:00–12:00")).style.width).toBe("100%");
    });

    it("never lets items on different days affect each other", async () => {
      items = [
        event("a", "Maandag-item", TODAY, "10:00", "11:00"),
        event("b", "Dinsdag-item", TUESDAY_ISO, "10:00", "11:00"),
      ];
      await renderAgenda();

      expect((await blockOf("Maandag-item, 10:00–11:00")).style.width).toBe("100%");
      expect((await blockOf("Dinsdag-item, 10:00–11:00")).style.width).toBe("100%");
    });

    /** An occupied hour still takes a new item: the hour block stays reachable. */
    it("adds a second item in an hour that already has one", async () => {
      items = [event("a", "Vergadering", TODAY, "10:00", "11:00")];
      await renderAgenda();
      const dialog = await clickSlot(MONDAY, "10:00");

      await userEvent.type(within(dialog).getByLabelText("Titel"), "Telefoon");
      await save(dialog);

      expect((await blockOf("Telefoon, 10:00–11:00")).style.left).toBe("50%");
      expect((await blockOf("Vergadering, 10:00–11:00")).style.left).toBe("0%");
    });
  });

  describe("changing an item", () => {
    beforeEach(() => {
      items = [event("a", "Vergadering", TODAY, "10:00", "11:00")];
    });

    async function openItem(): Promise<HTMLElement> {
      await renderAgenda();
      await userEvent.click(
        await screen.findByRole("button", { name: "Vergadering, 10:00–11:00" }),
      );

      return screen.findByRole("dialog", { name: "Agenda-item bewerken" });
    }

    it("opens with its title, day, start and end", async () => {
      const dialog = await openItem();

      expect(within(dialog).getByLabelText("Titel")).toHaveValue("Vergadering");
      expect(within(dialog).getByLabelText("Startdatum")).toHaveValue(TODAY);
      expect(within(dialog).getByLabelText("Starttijd")).toHaveValue("10:00");
      expect(within(dialog).getByLabelText("Eindtijd")).toHaveValue("11:00");
    });

    it("changes the title", async () => {
      const dialog = await openItem();

      await userEvent.clear(within(dialog).getByLabelText("Titel"));
      await userEvent.type(within(dialog).getByLabelText("Titel"), "Klantbezoek");
      await save(dialog);

      await waitFor(() => expect(writes("PATCH")).toHaveLength(1));
      expect(writes("PATCH")[0]).toEqual([
        `${PATH}/a`,
        expect.objectContaining({
          method: "PATCH",
          body: { title: "Klantbezoek", date: TODAY, startTime: "10:00", endTime: "11:00" },
        }),
      ]);
      expect(
        await screen.findByRole("button", { name: "Klantbezoek, 10:00–11:00" }),
      ).toBeInTheDocument();
    });

    it("moves the start", async () => {
      const dialog = await openItem();

      setField(dialog, "Starttijd", "10:30");
      await save(dialog);

      expect(
        await screen.findByRole("button", { name: "Vergadering, 10:30–11:00" }),
      ).toBeInTheDocument();
    });

    it("changes the end", async () => {
      const dialog = await openItem();

      setField(dialog, "Eindtijd", "12:00");
      await save(dialog);

      expect(
        await screen.findByRole("button", { name: "Vergadering, 10:00–12:00" }),
      ).toBeInTheDocument();
    });

    it("moves the item to another day of the week", async () => {
      const dialog = await openItem();

      setField(dialog, "Startdatum", "2026-09-17");
      await save(dialog);

      await waitFor(() => expect(writes("PATCH")).toHaveLength(1));
      expect(writes("PATCH")[0][1]).toMatchObject({ body: { date: "2026-09-17" } });
      expect(
        await within(day(THURSDAY)).findByRole("button", { name: "Vergadering, 10:00–11:00" }),
      ).toBeInTheDocument();
      expect(within(day(MONDAY)).queryByText("Vergadering")).not.toBeInTheDocument();
    });

    it("refuses an end before the start", async () => {
      const dialog = await openItem();

      setField(dialog, "Eindtijd", "09:00");
      await save(dialog);

      expect(within(dialog).getByRole("alert")).toHaveTextContent(
        "De eindtijd moet na de starttijd liggen.",
      );
      expect(writes("PATCH")).toHaveLength(0);
    });

    it("changes nothing when cancelled", async () => {
      const dialog = await openItem();

      await userEvent.clear(within(dialog).getByLabelText("Titel"));
      await userEvent.click(within(dialog).getByRole("button", { name: "Annuleren" }));

      expect(writes("PATCH")).toHaveLength(0);
      expect(
        screen.getByRole("button", { name: "Vergadering, 10:00–11:00" }),
      ).toBeInTheDocument();
    });
  });

  describe("deleting an item", () => {
    beforeEach(() => {
      items = [event("a", "Vergadering", TODAY, "10:00", "11:00")];
    });

    async function askToDelete(): Promise<HTMLElement> {
      await renderAgenda();
      await userEvent.click(
        await screen.findByRole("button", { name: "Vergadering, 10:00–11:00" }),
      );
      const dialog = await screen.findByRole("dialog", { name: "Agenda-item bewerken" });

      await userEvent.click(within(dialog).getByRole("button", { name: "Verwijderen" }));

      return screen.findByRole("dialog", { name: "Agenda-item verwijderen" });
    }

    it("asks first, naming the item", async () => {
      const confirmation = await askToDelete();

      expect(within(confirmation).getByText("Vergadering")).toBeInTheDocument();
      expect(within(confirmation).getByText(/14\/09\/2026 · 10:00–11:00/)).toBeInTheDocument();
      expect(writes("DELETE")).toHaveLength(0);
    });

    it("removes it from the calendar", async () => {
      const confirmation = await askToDelete();

      await userEvent.click(within(confirmation).getByRole("button", { name: "Verwijderen" }));

      await waitFor(() => expect(writes("DELETE")).toHaveLength(1));
      expect(writes("DELETE")[0][0]).toBe(`${PATH}/a`);
      await waitFor(() =>
        expect(
          screen.queryByRole("button", { name: "Vergadering, 10:00–11:00" }),
        ).not.toBeInTheDocument(),
      );
    });

    it("keeps it when the confirmation is cancelled", async () => {
      const confirmation = await askToDelete();

      await userEvent.click(within(confirmation).getByRole("button", { name: "Annuleren" }));

      expect(writes("DELETE")).toHaveLength(0);
      expect(
        screen.getByRole("button", { name: "Vergadering, 10:00–11:00" }),
      ).toBeInTheDocument();
    });
  });

  it("keeps what was added in another week", async () => {
    await renderAgenda();

    await userEvent.click(screen.getByRole("button", { name: "Volgende" }));
    await screen.findByText("21 – 27 september 2026");
    const dialog = await clickSlot("Dinsdag 22 september", "09:00");
    await userEvent.type(within(dialog).getByLabelText("Titel"), "Planning");
    await save(dialog);
    await screen.findByRole("button", { name: "Planning, 09:00–10:00" });

    await userEvent.click(screen.getByRole("button", { name: "Deze week" }));
    await screen.findByText("14 – 20 september 2026");
    expect(screen.queryByText("Planning")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Volgende" }));
    expect(
      await within(await waitFor(() => day("Dinsdag 22 september"))).findByRole("button", {
        name: "Planning, 09:00–10:00",
      }),
    ).toBeInTheDocument();
  });

  it("opens the week and the item a Dashboard link names", async () => {
    items = [event("e1", "Keuring", "2026-09-16", "08:00", "09:00")];
    mockSearchParams = new URLSearchParams("date=2026-09-16&event=e1");

    await renderAgenda();
    const dialog = await screen.findByRole("dialog", { name: "Agenda-item bewerken" });

    expect(within(dialog).getByLabelText("Titel")).toHaveValue("Keuring");
    expect(weekRequests()).toEqual(["2026-09-14..2026-09-20"]);
  });

  describe("the current time", () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it("draws a line at the local time, in today's column only", async () => {
      jest.useFakeTimers({ now: new Date(2026, 8, 14, 10, 30), doNotFake: [...ALL_BUT_DATE] });

      await renderAgenda();
      const lines = document.querySelectorAll<HTMLElement>("[data-agenda-now]");

      expect(lines).toHaveLength(1);
      expect(day(MONDAY).contains(lines[0])).toBe(true);
      expect(parseFloat(lines[0].style.top)).toBeCloseTo(4.5 * HOUR, 3);
    });

    it("draws no line in another week", async () => {
      jest.useFakeTimers({ now: new Date(2026, 8, 14, 10, 30), doNotFake: [...ALL_BUT_DATE] });

      await renderAgenda();
      await userEvent.click(screen.getByRole("button", { name: "Volgende" }));
      await screen.findByText("21 – 27 september 2026");

      expect(document.querySelectorAll("[data-agenda-now]")).toHaveLength(0);
    });
  });
});
