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
const TODAY = "2026-09-14";
const PATH = "/api/v1/calendar-events";

type Init = {
  method?: string;
  query?: { date?: string };
  body?: Record<string, string | null | undefined>;
};

/** The fake backend's store, by day. */
let days: Record<string, CalendarEvent[]>;
/** When set, the next write fails the way the backend would refuse it. */
let refusal: ApiError | null;
let createdCount: number;

function event(
  id: string,
  title: string,
  start: string,
  end: string,
  date = TODAY,
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
    const date = init.query?.date ?? "";
    const items = [...(days[date] ?? [])].sort((left, right) =>
      left.startTime.localeCompare(right.startTime),
    );

    return Promise.resolve({ date, dayStart: "06:00", dayEnd: "23:00", items });
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
      start,
      body.endTime ?? oneHourAfter(start),
      String(body.date),
    );

    days[created.date] = [...(days[created.date] ?? []), created];

    return Promise.resolve(created);
  }

  const id = path.slice(PATH.length + 1);
  const found = Object.values(days)
    .flat()
    .find((item) => item.id === id);

  if (!found) {
    return Promise.reject(new ApiError("NOT_FOUND", "No such Agenda item.", 404));
  }

  if (method === "PATCH") {
    const start = body.startTime ?? found.startTime.slice(0, 5);
    const end =
      body.endTime === null ? oneHourAfter(start) : (body.endTime ?? found.endTime.slice(0, 5));
    const changed = {
      ...found,
      title: body.title ?? found.title,
      startTime: `${start}:00`,
      endTime: `${end}:00`,
    };

    days[found.date] = days[found.date].map((item) => (item.id === id ? changed : item));

    return Promise.resolve(changed);
  }

  days[found.date] = days[found.date].filter((item) => item.id !== id);

  return Promise.resolve(found);
}

function writes(method: "POST" | "PATCH" | "DELETE") {
  return requestMock.mock.calls.filter(
    ([, init]) => (init as Init | undefined)?.method === method,
  );
}

function dayRequests(): string[] {
  return requestMock.mock.calls
    .filter(([path, init]) => path === PATH && !(init as Init | undefined)?.method)
    .map(([, init]) => String((init as Init).query?.date));
}

function renderAgenda(): Promise<HTMLElement> {
  render(
    <ThemeProvider>
      <LanguageProvider>
        <CalendarPage />
      </LanguageProvider>
    </ThemeProvider>,
  );

  return screen.findByRole("group", { name: "Dagagenda" });
}

async function clickHour(time: string): Promise<HTMLElement> {
  await userEvent.click(
    await screen.findByRole("button", { name: `Nieuw agenda-item om ${time}` }),
  );

  return screen.findByRole("dialog", { name: "Nieuw agenda-item" });
}

/** The positioned block around an item's button. */
async function blockOf(name: string): Promise<HTMLElement> {
  return (await screen.findByRole("button", { name })).parentElement as HTMLElement;
}

function setTime(dialog: HTMLElement, label: string, value: string): void {
  fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });
}

describe("the Agenda", () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockImplementation((...args: unknown[]) =>
      fakeBackend(args[0] as string, args[1] as Init | undefined),
    );
    days = {};
    refusal = null;
    createdCount = 0;
    mockSearchParams = new URLSearchParams();
    window.localStorage.clear();
  });

  describe("the day", () => {
    it("opens on today, as the backend answers it", async () => {
      await renderAgenda();

      expect(dayRequests()).toEqual([TODAY]);
      expect(screen.getByText("Maandag 14 september 2026")).toBeInTheDocument();
      expect(screen.getByText("Vandaag", { selector: "h1 span" })).toBeInTheDocument();
    });

    it("has an hour block for every hour from 06:00 to 22:00, ending at 23:00", async () => {
      const grid = await renderAgenda();

      expect(
        within(grid).getAllByRole("button", { name: /^Nieuw agenda-item om/ }),
      ).toHaveLength(17);
      expect(
        within(grid).getByRole("button", { name: "Nieuw agenda-item om 06:00" }),
      ).toBeInTheDocument();
      expect(
        within(grid).getByRole("button", { name: "Nieuw agenda-item om 22:00" }),
      ).toBeInTheDocument();
      expect(
        within(grid).queryByRole("button", { name: "Nieuw agenda-item om 23:00" }),
      ).not.toBeInTheDocument();
      expect(within(grid).getByText("06:00")).toBeInTheDocument();
      expect(within(grid).getByText("23:00")).toBeInTheDocument();
    });

    it("moves to the next and previous day, and back to today", async () => {
      await renderAgenda();

      await userEvent.click(screen.getByRole("button", { name: "Volgende" }));
      await waitFor(() => expect(dayRequests()).toContain("2026-09-15"));
      expect(await screen.findByText("Dinsdag 15 september 2026")).toBeInTheDocument();
      expect(screen.queryByText("Vandaag", { selector: "h1 span" })).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Vorige" }));
      await userEvent.click(screen.getByRole("button", { name: "Vorige" }));
      await waitFor(() => expect(dayRequests()).toContain("2026-09-13"));

      await userEvent.click(screen.getByRole("button", { name: "Vandaag" }));
      await waitFor(() => expect(dayRequests().at(-1)).toBe(TODAY));
    });

    it("shows only the selected day's items", async () => {
      days["2026-09-13"] = [event("y", "Gisteren", "09:00", "10:00", "2026-09-13")];
      days[TODAY] = [event("t", "Vandaag-item", "09:00", "10:00")];
      days["2026-09-15"] = [event("m", "Morgen", "09:00", "10:00", "2026-09-15")];

      await renderAgenda();

      expect(
        await screen.findByRole("button", { name: "Vandaag-item, 09:00–10:00" }),
      ).toBeInTheDocument();
      expect(screen.queryByText("Gisteren")).not.toBeInTheDocument();
      expect(screen.queryByText("Morgen")).not.toBeInTheDocument();
    });
  });

  describe("adding an item", () => {
    it("starts at the hour that was clicked and, without an end, lasts one hour", async () => {
      await renderAgenda();
      const dialog = await clickHour("10:00");

      expect(within(dialog).getByText("10:00")).toBeInTheDocument();

      await userEvent.type(within(dialog).getByLabelText("Titel"), "Vergadering");
      await userEvent.click(within(dialog).getByRole("button", { name: "Opslaan" }));

      await waitFor(() => expect(writes("POST")).toHaveLength(1));
      expect(writes("POST")[0]).toEqual([
        PATH,
        expect.objectContaining({
          method: "POST",
          body: { title: "Vergadering", date: TODAY, startTime: "10:00" },
        }),
      ]);
      expect(
        await screen.findByRole("button", { name: "Vergadering, 10:00–11:00" }),
      ).toBeInTheDocument();
      expect(screen.getByText("Agenda-item toegevoegd.")).toBeInTheDocument();
    });

    it("draws a one-hour item exactly one hour tall, at its hour", async () => {
      days[TODAY] = [event("a", "Vergadering", "10:00", "11:00")];
      await renderAgenda();

      const block = await blockOf("Vergadering, 10:00–11:00");

      expect(parseFloat(block.style.top)).toBeCloseTo((4 * 100) / 17, 3);
      expect(parseFloat(block.style.height)).toBeCloseTo(100 / 17, 3);
    });

    it("sends the end that was chosen", async () => {
      await renderAgenda();
      const dialog = await clickHour("10:00");

      await userEvent.type(within(dialog).getByLabelText("Titel"), "Vergadering");
      setTime(dialog, "Eindtijd", "11:30");
      await userEvent.click(within(dialog).getByRole("button", { name: "Opslaan" }));

      await waitFor(() => expect(writes("POST")).toHaveLength(1));
      expect(writes("POST")[0][1]).toMatchObject({
        body: { title: "Vergadering", date: TODAY, startTime: "10:00", endTime: "11:30" },
      });
      expect(
        await screen.findByRole("button", { name: "Vergadering, 10:00–11:30" }),
      ).toBeInTheDocument();
    });

    it("requires a title", async () => {
      await renderAgenda();
      const dialog = await clickHour("10:00");

      await userEvent.type(within(dialog).getByLabelText("Titel"), "   ");
      await userEvent.click(within(dialog).getByRole("button", { name: "Opslaan" }));

      expect(within(dialog).getByRole("alert")).toHaveTextContent("Vul een titel in.");
      expect(writes("POST")).toHaveLength(0);
    });

    it.each(["09:30", "10:00"])("refuses an end of %s for a 10:00 start", async (end) => {
      await renderAgenda();
      const dialog = await clickHour("10:00");

      await userEvent.type(within(dialog).getByLabelText("Titel"), "Vergadering");
      setTime(dialog, "Eindtijd", end);
      await userEvent.click(within(dialog).getByRole("button", { name: "Opslaan" }));

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
      const dialog = await clickHour("22:00");

      await userEvent.type(within(dialog).getByLabelText("Titel"), "Laat");
      setTime(dialog, "Eindtijd", "23:30");
      await userEvent.click(within(dialog).getByRole("button", { name: "Opslaan" }));

      expect(await within(dialog).findByRole("alert")).toHaveTextContent(
        /between 06:00 and 23:00/,
      );
      expect(within(dialog).getByLabelText("Titel")).toHaveValue("Laat");
    });

    it("sends nothing when cancelled", async () => {
      await renderAgenda();
      const dialog = await clickHour("10:00");

      await userEvent.type(within(dialog).getByLabelText("Titel"), "Vergadering");
      await userEvent.click(within(dialog).getByRole("button", { name: "Annuleren" }));

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(writes("POST")).toHaveLength(0);
    });

    /** An occupied hour still takes a new item: the hour block stays reachable. */
    it("adds a second item in an hour that already has one", async () => {
      days[TODAY] = [event("a", "Vergadering", "10:00", "11:00")];
      await renderAgenda();
      const dialog = await clickHour("10:00");

      await userEvent.type(within(dialog).getByLabelText("Titel"), "Telefoon");
      await userEvent.click(within(dialog).getByRole("button", { name: "Opslaan" }));

      const first = await blockOf("Vergadering, 10:00–11:00");
      const second = await blockOf("Telefoon, 10:00–11:00");

      expect([first.style.left, first.style.width]).toEqual(["0%", "50%"]);
      expect([second.style.left, second.style.width]).toEqual(["50%", "50%"]);
    });
  });

  describe("changing an item", () => {
    beforeEach(() => {
      days[TODAY] = [event("a", "Vergadering", "10:00", "11:00")];
    });

    async function openItem(): Promise<HTMLElement> {
      await renderAgenda();
      await userEvent.click(
        await screen.findByRole("button", { name: "Vergadering, 10:00–11:00" }),
      );

      return screen.findByRole("dialog", { name: "Agenda-item bewerken" });
    }

    it("opens with its title, start and end", async () => {
      const dialog = await openItem();

      expect(within(dialog).getByLabelText("Titel")).toHaveValue("Vergadering");
      expect(within(dialog).getByLabelText("Starttijd")).toHaveValue("10:00");
      expect(within(dialog).getByLabelText("Eindtijd")).toHaveValue("11:00");
    });

    it("changes the title", async () => {
      const dialog = await openItem();

      await userEvent.clear(within(dialog).getByLabelText("Titel"));
      await userEvent.type(within(dialog).getByLabelText("Titel"), "Klantbezoek");
      await userEvent.click(within(dialog).getByRole("button", { name: "Opslaan" }));

      await waitFor(() => expect(writes("PATCH")).toHaveLength(1));
      expect(writes("PATCH")[0]).toEqual([
        `${PATH}/a`,
        expect.objectContaining({
          method: "PATCH",
          body: { title: "Klantbezoek", startTime: "10:00", endTime: "11:00" },
        }),
      ]);
      expect(
        await screen.findByRole("button", { name: "Klantbezoek, 10:00–11:00" }),
      ).toBeInTheDocument();
    });

    it("moves the start", async () => {
      const dialog = await openItem();

      setTime(dialog, "Starttijd", "10:30");
      await userEvent.click(within(dialog).getByRole("button", { name: "Opslaan" }));

      await waitFor(() => expect(writes("PATCH")).toHaveLength(1));
      expect(writes("PATCH")[0][1]).toMatchObject({ body: { startTime: "10:30" } });
      expect(
        await screen.findByRole("button", { name: "Vergadering, 10:30–11:00" }),
      ).toBeInTheDocument();
    });

    it("changes the end", async () => {
      const dialog = await openItem();

      setTime(dialog, "Eindtijd", "12:00");
      await userEvent.click(within(dialog).getByRole("button", { name: "Opslaan" }));

      await waitFor(() => expect(writes("PATCH")).toHaveLength(1));
      expect(writes("PATCH")[0][1]).toMatchObject({ body: { endTime: "12:00" } });
      expect(
        await screen.findByRole("button", { name: "Vergadering, 10:00–12:00" }),
      ).toBeInTheDocument();
    });

    it("keeps the item on its day", async () => {
      const dialog = await openItem();

      setTime(dialog, "Starttijd", "08:00");
      setTime(dialog, "Eindtijd", "09:00");
      await userEvent.click(within(dialog).getByRole("button", { name: "Opslaan" }));

      await waitFor(() => expect(writes("PATCH")).toHaveLength(1));
      expect(writes("PATCH")[0][1]).not.toHaveProperty("body.date");
      expect(
        await screen.findByRole("button", { name: "Vergadering, 08:00–09:00" }),
      ).toBeInTheDocument();
      expect(new Set(dayRequests())).toEqual(new Set([TODAY]));
    });

    it("refuses an end before the start", async () => {
      const dialog = await openItem();

      setTime(dialog, "Eindtijd", "09:00");
      await userEvent.click(within(dialog).getByRole("button", { name: "Opslaan" }));

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
      days[TODAY] = [event("a", "Vergadering", "10:00", "11:00")];
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

    it("removes it from the Agenda", async () => {
      const confirmation = await askToDelete();

      await userEvent.click(
        within(confirmation).getByRole("button", { name: "Verwijderen" }),
      );

      await waitFor(() => expect(writes("DELETE")).toHaveLength(1));
      expect(writes("DELETE")[0][0]).toBe(`${PATH}/a`);
      await waitFor(() =>
        expect(
          screen.queryByRole("button", { name: "Vergadering, 10:00–11:00" }),
        ).not.toBeInTheDocument(),
      );
      expect(screen.getByText("Agenda-item verwijderd.")).toBeInTheDocument();
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

  describe("overlapping items", () => {
    it("stands 10:00–11:00 and 10:30–12:00 side by side", async () => {
      days[TODAY] = [
        event("a", "Vergadering", "10:00", "11:00"),
        event("b", "Telefoon", "10:30", "12:00"),
      ];
      await renderAgenda();

      const first = await blockOf("Vergadering, 10:00–11:00");
      const second = await blockOf("Telefoon, 10:30–12:00");

      expect([first.style.left, first.style.width]).toEqual(["0%", "50%"]);
      expect([second.style.left, second.style.width]).toEqual(["50%", "50%"]);
      expect(parseFloat(second.style.height)).toBeCloseTo(
        parseFloat(first.style.height) * 1.5,
        3,
      );
    });

    it("gives items that only meet the whole width each", async () => {
      days[TODAY] = [
        event("a", "Vergadering", "10:00", "11:00"),
        event("b", "Telefoon", "11:00", "12:00"),
      ];
      await renderAgenda();

      const first = await blockOf("Vergadering, 10:00–11:00");
      const second = await blockOf("Telefoon, 11:00–12:00");

      expect([first.style.left, first.style.width]).toEqual(["0%", "100%"]);
      expect([second.style.left, second.style.width]).toEqual(["0%", "100%"]);
    });
  });

  it("opens the day and the item a Dashboard link names", async () => {
    days["2026-09-20"] = [event("e1", "Keuring", "08:00", "09:00", "2026-09-20")];
    mockSearchParams = new URLSearchParams("date=2026-09-20&event=e1");

    await renderAgenda();
    const dialog = await screen.findByRole("dialog", { name: "Agenda-item bewerken" });

    expect(within(dialog).getByLabelText("Titel")).toHaveValue("Keuring");
    expect(dayRequests()).toEqual(["2026-09-20"]);
  });

  /** Wall-clock values from the backend are drawn as they are, at the day's edges too. */
  it("shows the day's first and last hour exactly as the backend sent them", async () => {
    days[TODAY] = [
      event("a", "Vroeg", "06:00", "07:00"),
      event("b", "Laat", "22:00", "23:00"),
    ];
    await renderAgenda();

    const early = await blockOf("Vroeg, 06:00–07:00");
    const late = await blockOf("Laat, 22:00–23:00");

    expect(parseFloat(early.style.top)).toBe(0);
    expect(parseFloat(late.style.top) + parseFloat(late.style.height)).toBeCloseTo(100, 3);
  });
});
