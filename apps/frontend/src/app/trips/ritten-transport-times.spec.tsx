import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  buildPage,
  buildTrip,
  mutationCalls,
  renderRitten,
  respondWith,
} from "./ritten-test-support";
import { ApiError, request } from "@/lib/api/client";
import type { Trip } from "@/lib/api/types";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

const requestMock = request as jest.MockedFunction<typeof request>;

/**
 * Editing a Trip's transport times in the list.
 *
 * ── THESE ARE NOT THE WAITING TIME ──────────────────────────────────────────
 * Begin and Eind are the hours the TRANSPORT is planned for, as the order
 * states them. The waiting time is a different thing entirely — its own column,
 * entered as its own two clock times and stored as `waitingTimeMinutes`. The
 * tests below assert that changing one never writes the other, because the two
 * look alike on screen and confusing them would put money on the wrong number.
 *
 * ── EDITABLE ONLY ON A TRIP CREATED BY HAND ─────────────────────────────────
 * The same rule the destination already follows. An imported Trip belongs to
 * its document, which a later UPDATE re-reads, so anything typed here would be
 * silently overwritten — and the backend refuses it with a 409.
 *
 * ── AND NO ORDERING RULE ────────────────────────────────────────────────────
 * An end before a start is a transport running past midnight. An end equal to
 * the start is what a single-time order produces. Neither is refused, here or
 * in the backend.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** No PDF: the operator is the only possible author of these times. */
const MANUAL = { pdfDocumentId: null } as const;

function patchBody(): Record<string, unknown> | undefined {
  const call = mutationCalls(requestMock).find(([path]) =>
    String(path).startsWith("/api/v1/trips/trip-1"),
  );

  return (call?.[1] as { body?: Record<string, unknown> } | undefined)?.body;
}

function patchCalls() {
  return mutationCalls(requestMock).filter(([path]) =>
    String(path).startsWith("/api/v1/trips/trip-1"),
  );
}

async function show(overrides: Partial<Trip> = {}): Promise<void> {
  respondWith(requestMock, {
    trips: buildPage([buildTrip({ ...MANUAL, ...overrides })]),
  });
  renderRitten();
  await screen.findByRole("table");
}

/** Opens the cell and returns the time input. */
async function openTime(label: string): Promise<HTMLElement> {
  await userEvent.click(await screen.findByRole("button", { name: label }));

  return screen.getByLabelText(label);
}

/**
 * Types a time and leaves the field, which is what saves it.
 *
 * There is no Save button: leaving the field is the moment the value is
 * finished. `userEvent.tab()` is the honest way to say "the operator moved on".
 */
async function setTime(label: string, value: string): Promise<void> {
  const input = await openTime(label);
  await userEvent.clear(input);
  await userEvent.type(input, value);
  await userEvent.tab();
}

const BEGIN = "Begin transport";
const END = "Einde transport";

describe("the transport times in the Ritten list", () => {
  beforeEach(() => {
    requestMock.mockReset();
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  describe("opening them", () => {
    it("offers the start time for editing", async () => {
      await show();

      expect(
        await screen.findByRole("button", { name: BEGIN }),
      ).toBeEnabled();
    });

    it("offers the end time for editing", async () => {
      await show();

      expect(await screen.findByRole("button", { name: END })).toBeEnabled();
    });

    it("uses a clock input", async () => {
      await show();

      expect(await openTime(BEGIN)).toHaveAttribute("type", "time");
    });

    /** `HH:MM`, not the `HH:MM:SS` the backend sends. */
    it("opens on the stored value in HH:mm", async () => {
      await show({ startTime: "10:00:00" });

      expect(await openTime(BEGIN)).toHaveValue("10:00");
    });

    it("opens empty when there is no time yet", async () => {
      await show({ startTime: null });

      expect(await openTime(BEGIN)).toHaveValue("");
    });

    it("shows the empty marker for a Trip with no times", async () => {
      await show({ startTime: null, endTime: null });

      const row = screen.getByRole("row", { name: /ANRDUB2602247/ });

      expect(within(row).getAllByText("—").length).toBeGreaterThan(0);
    });
  });

  describe("saving them", () => {
    it("sends the new start time", async () => {
      await show();
      await setTime(BEGIN, "08:00");

      await waitFor(() => {
        expect(patchBody()).toEqual({ startTime: "08:00" });
      });
    });

    it("sends the new end time", async () => {
      await show();
      await setTime(END, "12:30");

      await waitFor(() => {
        expect(patchBody()).toEqual({ endTime: "12:30" });
      });
    });

    /** Each field moves on its own; the other is not sent at all. */
    it("sends only the field that changed", async () => {
      await show();
      await setTime(BEGIN, "08:00");

      await waitFor(() => expect(patchBody()).toBeDefined());
      expect(patchBody()).not.toHaveProperty("endTime");
    });

    it("clears a time when the box is emptied", async () => {
      await show({ startTime: "10:00:00" });

      const input = await openTime(BEGIN);
      await userEvent.clear(input);
      await userEvent.tab();

      await waitFor(() => {
        expect(patchBody()).toEqual({ startTime: null });
      });
    });

    it("sends one request for one change", async () => {
      await show();
      await setTime(BEGIN, "08:00");

      await waitFor(() => expect(patchCalls()).toHaveLength(1));
    });

    it("sends nothing when the cell is opened and cancelled", async () => {
      await show();

      await openTime(BEGIN);
      await userEvent.click(screen.getByRole("button", { name: "Annuleren" }));

      expect(patchCalls()).toHaveLength(0);
    });

    /** Immediate: there is nothing further to press. */
    it("offers no Save button", async () => {
      await show();

      await openTime(BEGIN);

      expect(
        screen.queryByRole("button", { name: "Opslaan" }),
      ).not.toBeInTheDocument();
    });

    /** Leaving a field nobody touched is not a change. */
    it("sends nothing when the field is left untouched", async () => {
      await show({ startTime: "10:00:00" });

      await openTime(BEGIN);
      await userEvent.tab();

      expect(patchCalls()).toHaveLength(0);
    });

    /** Never painted locally: the row shows what the refetched Trip says. */
    it("shows the persisted value afterwards", async () => {
      await show({ startTime: "10:00:00" });

      const input = await openTime(BEGIN);
      respondWith(requestMock, {
        trips: buildPage([buildTrip({ ...MANUAL, startTime: "08:00:00" })]),
      });
      await userEvent.clear(input);
      await userEvent.type(input, "08:00");
      await userEvent.tab();

      expect(await screen.findByText("08:00")).toBeInTheDocument();
    });
  });

  /**
   * An end before a start is an overnight transport; an end equal to a start is
   * what "21/08/2026 15:00" produces. Neither is refused.
   */
  describe("what it does not refuse", () => {
    it("accepts an end that precedes the start", async () => {
      await show({ startTime: "22:00:00" });
      await setTime(END, "02:00");

      await waitFor(() => {
        expect(patchBody()).toEqual({ endTime: "02:00" });
      });
    });

    it("accepts an end equal to the start", async () => {
      await show({ startTime: "15:00:00" });
      await setTime(END, "15:00");

      await waitFor(() => {
        expect(patchBody()).toEqual({ endTime: "15:00" });
      });
    });

    /** A single-time order: one half moves without dragging the other. */
    it("moves one half of a single-time order alone", async () => {
      await show({ startTime: "15:00:00", endTime: "15:00:00" });
      await setTime(END, "16:00");

      await waitFor(() => {
        expect(patchBody()).toEqual({ endTime: "16:00" });
      });
    });
  });

  describe("the waiting time", () => {
    it("is never sent with a transport time", async () => {
      await show({ waitingTimeMinutes: 45 });
      await setTime(BEGIN, "08:00");

      await waitFor(() => expect(patchBody()).toBeDefined());
      expect(patchBody()).not.toHaveProperty("waitingTimeMinutes");
    });

    it("still reads as it did", async () => {
      await show({ waitingTimeMinutes: 45 });
      await setTime(BEGIN, "08:00");

      await waitFor(() => expect(patchCalls()).toHaveLength(1));
      expect(screen.getByText("45 min")).toBeInTheDocument();
    });

    /** Its own cell is untouched: a different concept, its own control. */
    it("keeps its own editor", async () => {
      await show({ waitingTimeMinutes: 45 });

      await userEvent.click(
        screen.getByRole("button", { name: "Wachttijd in minuten" }),
      );

      expect(screen.getByLabelText("Begin")).toBeInTheDocument();
      expect(screen.getByLabelText("Eind")).toBeInTheDocument();
    });
  });

  describe("when the backend refuses", () => {
    async function refuse(): Promise<void> {
      await show({ startTime: "10:00:00" });

      const input = await openTime(BEGIN);
      requestMock.mockRejectedValueOnce(
        new ApiError("VALIDATION_FAILED", "startTime must be HH:mm.", 400),
      );
      await userEvent.clear(input);
      await userEvent.type(input, "08:00");
      await userEvent.tab();
    }

    /**
     * Nothing was painted, so nothing has to be undone: closing the editor
     * shows the stored value again, unchanged.
     */
    it("leaves the stored value untouched", async () => {
      await refuse();
      await screen.findAllByText(/must be HH:mm/);

      await userEvent.click(screen.getByRole("button", { name: "Annuleren" }));

      expect(screen.getByText("10:00")).toBeInTheDocument();
    });

    it("says why", async () => {
      await refuse();

      expect(await screen.findAllByText(/must be HH:mm/)).not.toHaveLength(0);
    });

    it("leaves the cell open to try again", async () => {
      await refuse();

      await screen.findAllByText(/must be HH:mm/);
      expect(screen.getByLabelText(BEGIN)).toBeInTheDocument();
    });
  });

  /**
   * An imported Trip takes them like any other. A later UPDATE document may
   * still revise them — that is what a revision is for — and until one does the
   * operator's value stands.
   */
  describe("an imported Trip", () => {
    /**
     * They were briefly refused here, like the destination. The owner decided
     * otherwise: Begin and Eind are planning an operator adjusts as a day
     * unfolds, exactly like the planning date beside them.
     */
    it("offers them for editing too", async () => {
      await show({ pdfDocumentId: "pdf-1" });

      expect(await screen.findByRole("button", { name: BEGIN })).toBeEnabled();
      expect(screen.getByRole("button", { name: END })).toBeEnabled();
    });

    it("still displays them", async () => {
      await show({ pdfDocumentId: "pdf-1", startTime: "10:00:00" });

      expect(screen.getByText("10:00")).toBeInTheDocument();
    });

    it("offers nothing on a DELETED manual Trip either", async () => {
      await show({ status: "DELETED" });

      expect(
        screen.queryByRole("button", { name: BEGIN }),
      ).not.toBeInTheDocument();
    });
  });

  describe("presentation", () => {
    it("is translated", async () => {
      window.localStorage.setItem("tms.language", "tr");
      await show();

      expect(
        await screen.findByRole("button", { name: "Taşıma başlangıcı" }),
      ).toBeEnabled();
      expect(
        screen.getByRole("button", { name: "Taşıma bitişi" }),
      ).toBeEnabled();
    });

    it.each(["light", "dark"])(
      "uses design tokens in %s mode",
      async (theme) => {
        document.documentElement.classList.toggle("dark", theme === "dark");
        await show();

        const editor = (await openTime(BEGIN)).closest("div") as HTMLElement;

        expect(editor.className).toMatch(/bg-card|border-primary/);
        expect(editor.innerHTML).not.toMatch(/#[0-9a-f]{3,8}/i);
      },
    );

    it("names each field for a screen reader", async () => {
      await show();

      expect(await openTime(BEGIN)).toHaveAccessibleName(BEGIN);
    });
  });
});
