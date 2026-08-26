import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  buildPage,
  buildTrip,
  mutationCalls,
  renderRitten,
  respondWith,
} from "./ritten-test-support";
import { request } from "@/lib/api/client";
import type { Trip } from "@/lib/api/types";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

const requestMock = request as jest.MockedFunction<typeof request>;

/**
 * Waiting time: the window it was read off, and the duration between.
 *
 * ── ALL THREE ARE STORED NOW ────────────────────────────────────────────────
 * Only the duration used to survive, so the column could not say where the
 * figure came from and the editor opened blank on a Trip that already had one.
 * The two clock times persist beside it, and the BACKEND derives the minutes
 * from them — they are not sent — which is what keeps the money and the
 * evidence for it from disagreeing.
 *
 * ── A LEGACY ENTRY KEEPS ITS SILENCE ────────────────────────────────────────
 * A Trip whose waiting time predates the two columns has a duration and no
 * times. It shows the duration alone. 135 minutes has unlimited begin/end
 * pairs, and inventing one would put hours on screen nobody ever read.
 * ────────────────────────────────────────────────────────────────────────────
 */

const BEGIN = "Begin";
const END = "Eind";

/** Entered as a window: all three values present. */
const MEASURED: Partial<Trip> = {
  waitingTimeStart: "08:00:00",
  waitingTimeEnd: "10:15:00",
  waitingTimeMinutes: 135,
};

/** Entered before the two columns existed: a duration and nothing else. */
const LEGACY: Partial<Trip> = {
  waitingTimeStart: null,
  waitingTimeEnd: null,
  waitingTimeMinutes: 45,
};

function patchBody(): Record<string, unknown> | undefined {
  const call = mutationCalls(requestMock).find(([path]) =>
    String(path).startsWith("/api/v1/trips/trip-1"),
  );

  return (call?.[1] as { body?: Record<string, unknown> } | undefined)?.body;
}

async function show(overrides: Partial<Trip> = {}): Promise<void> {
  respondWith(requestMock, { trips: buildPage([buildTrip(overrides)]) });
  renderRitten();
  await screen.findByRole("table");
}

async function openEditor(): Promise<void> {
  await userEvent.click(
    await screen.findByRole("button", { name: "Wachttijd in minuten" }),
  );
}

function setClock(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

async function save(): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));
}

describe("the waiting-time window in the Ritten list", () => {
  beforeEach(() => {
    requestMock.mockReset();
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  describe("what the column shows", () => {
    it("shows the window it was read off", async () => {
      await show(MEASURED);

      expect(screen.getByText("08:00 – 10:15")).toBeInTheDocument();
    });

    it("shows the duration under it", async () => {
      await show(MEASURED);

      expect(screen.getByText("2 u 15 min")).toBeInTheDocument();
    });

    /** Derived, so it reads as subordinate rather than as a second number. */
    it("renders the duration more quietly than the times", async () => {
      await show(MEASURED);

      expect(screen.getByText("2 u 15 min").className).toMatch(/text-muted/);
      expect(screen.getByText("08:00 – 10:15").className).toMatch(
        /text-foreground/,
      );
    });

    /** A legacy entry: the duration alone, and no invented times. */
    it("shows only the duration when there is no window", async () => {
      await show(LEGACY);

      expect(screen.getByText("45 min")).toBeInTheDocument();
      expect(screen.queryByText(/–/)).toBeNull();
      expect(screen.queryByText(/00:00/)).toBeNull();
    });

    it("shows the empty marker when there is no waiting time at all", async () => {
      await show({ waitingTimeStart: null, waitingTimeEnd: null, waitingTimeMinutes: null });

      const row = screen.getByRole("row", { name: /ANRDUB2602247/ });

      expect(within(row).getAllByText("—").length).toBeGreaterThan(0);
    });
  });

  describe("opening the editor", () => {
    /** On what was actually entered, which is recoverable now. */
    it("opens on the stored window", async () => {
      await show(MEASURED);
      await openEditor();

      expect(screen.getByLabelText(BEGIN)).toHaveValue("08:00");
      expect(screen.getByLabelText(END)).toHaveValue("10:15");
    });

    /** Nothing to reconstruct from 45 minutes, so nothing is put there. */
    it("opens empty on a legacy entry", async () => {
      await show(LEGACY);
      await openEditor();

      expect(screen.getByLabelText(BEGIN)).toHaveValue("");
      expect(screen.getByLabelText(END)).toHaveValue("");
    });

    it("previews the duration while typing", async () => {
      await show({ waitingTimeMinutes: null });
      await openEditor();

      setClock(BEGIN, "10:00");
      setClock(END, "12:15");

      expect(await screen.findByText("2 u 15 min")).toBeInTheDocument();
    });
  });

  describe("what it sends", () => {
    it("sends the window, never the duration", async () => {
      await show({ waitingTimeMinutes: null });
      await openEditor();

      setClock(BEGIN, "10:00");
      setClock(END, "12:15");
      await save();

      await waitFor(() => {
        expect(patchBody()).toEqual({
          waitingTimeStart: "10:00",
          waitingTimeEnd: "12:15",
        });
      });
      expect(patchBody()).not.toHaveProperty("waitingTimeMinutes");
    });

    it("changes the begin alone", async () => {
      await show(MEASURED);
      await openEditor();

      setClock(BEGIN, "09:00");
      await save();

      await waitFor(() => {
        expect(patchBody()).toEqual({
          waitingTimeStart: "09:00",
          waitingTimeEnd: "10:15",
        });
      });
    });

    it("changes the end alone", async () => {
      await show(MEASURED);
      await openEditor();

      setClock(END, "11:30");
      await save();

      await waitFor(() => {
        expect(patchBody()).toEqual({
          waitingTimeStart: "08:00",
          waitingTimeEnd: "11:30",
        });
      });
    });

    it("sends a window that crosses midnight unchanged", async () => {
      await show({ waitingTimeMinutes: null });
      await openEditor();

      setClock(BEGIN, "22:00");
      setClock(END, "02:00");
      await save();

      await waitFor(() => {
        expect(patchBody()).toEqual({
          waitingTimeStart: "22:00",
          waitingTimeEnd: "02:00",
        });
      });
    });

    it("sends one request", async () => {
      await show(MEASURED);
      await openEditor();

      setClock(END, "11:30");
      await save();

      await waitFor(() => {
        expect(mutationCalls(requestMock)).toHaveLength(1);
      });
    });
  });

  /**
   * Removing the ENTRY, not the Trip — which is why it is worded as the waiting
   * time. All three values go together, so nothing is left half-stated.
   */
  describe("removing the entry", () => {
    it("is offered when there is one", async () => {
      await show(MEASURED);
      await openEditor();

      expect(
        screen.getByRole("button", { name: "Wachttijd verwijderen" }),
      ).toBeEnabled();
    });

    it("is not offered when there is nothing to remove", async () => {
      await show({ waitingTimeStart: null, waitingTimeEnd: null, waitingTimeMinutes: null });
      await openEditor();

      expect(
        screen.queryByRole("button", { name: "Wachttijd verwijderen" }),
      ).toBeNull();
    });

    it("clears the window", async () => {
      await show(MEASURED);
      await openEditor();

      await userEvent.click(
        screen.getByRole("button", { name: "Wachttijd verwijderen" }),
      );

      await waitFor(() => {
        expect(patchBody()).toEqual({
          waitingTimeStart: null,
          waitingTimeEnd: null,
        });
      });
    });

    /** It removes a waiting time, and says so — never "Verwijderen" alone. */
    it("is worded as the waiting time, not as the Trip", async () => {
      await show(MEASURED);
      await openEditor();

      const remove = screen.getByRole("button", {
        name: "Wachttijd verwijderen",
      });

      expect(remove.textContent).toContain("Wachttijd");
    });

    it("leaves the row showing the empty marker once refetched", async () => {
      await show(MEASURED);
      await openEditor();

      respondWith(requestMock, {
        trips: buildPage([
          buildTrip({
            waitingTimeStart: null,
            waitingTimeEnd: null,
            waitingTimeMinutes: null,
          }),
        ]),
      });
      await userEvent.click(
        screen.getByRole("button", { name: "Wachttijd verwijderen" }),
      );

      await waitFor(() => {
        expect(screen.queryByText("2 u 15 min")).toBeNull();
      });
    });
  });

  describe("what it never touches", () => {
    it("sends nothing about the transport times", async () => {
      await show({ ...MEASURED, startTime: "09:00:00", endTime: "12:00:00" });
      await openEditor();

      setClock(END, "11:30");
      await save();

      await waitFor(() => expect(patchBody()).toBeDefined());
      expect(patchBody()).not.toHaveProperty("startTime");
      expect(patchBody()).not.toHaveProperty("endTime");
      expect(patchBody()).not.toHaveProperty("planningDate");
    });

    /** The transport window keeps its own cells, in its own columns. */
    it("leaves the transport times on screen unchanged", async () => {
      await show({ ...MEASURED, startTime: "09:00:00", endTime: "12:00:00" });

      expect(screen.getByText("09:00")).toBeInTheDocument();
      expect(screen.getByText("12:00")).toBeInTheDocument();
    });
  });

  describe("presentation", () => {
    it("is translated", async () => {
      window.localStorage.setItem("tms.language", "tr");
      await show(MEASURED);

      await userEvent.click(
        await screen.findByRole("button", { name: "Bekleme süresi (dakika)" }),
      );

      expect(
        screen.getByRole("button", { name: "Bekleme süresini sil" }),
      ).toBeInTheDocument();
    });

    it.each(["light", "dark"])(
      "uses design tokens in %s mode",
      async (theme) => {
        document.documentElement.classList.toggle("dark", theme === "dark");
        await show(MEASURED);

        const window_ = screen.getByText("08:00 – 10:15");

        expect(window_.className).not.toMatch(/#[0-9a-f]{3,8}/i);
        expect(screen.getByText("2 u 15 min").className).not.toMatch(
          /#[0-9a-f]{3,8}/i,
        );
      },
    );
  });
});
