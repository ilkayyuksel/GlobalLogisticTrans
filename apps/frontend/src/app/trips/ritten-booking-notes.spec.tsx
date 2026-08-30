import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { request } from "@/lib/api/client";
import {
  buildPage,
  buildTrip,
  renderRitten,
  respondWith,
} from "./ritten-test-support";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

const requestMock = request as unknown as jest.MockedFunction<
  (path: string, options?: Record<string, unknown>) => Promise<unknown>
>;

/**
 * The Trip's internal notes, on the booking number.
 *
 * ── WHAT THESE TESTS GUARD ──────────────────────────────────────────────────
 *   the note is the Trip's OWN `internalNotes` — never a combination of
 *     unrelated fields, and never anything else about the Trip;
 *   it costs NO request. The note travels on the Trip the list already
 *     returned, so a page of rows is still one list call;
 *   a Trip with no note shows no popup at all, rather than an empty one;
 *   it is reachable by KEYBOARD, not only by mouse — and it survives the
 *     pointer moving onto it, which is what makes a long note readable;
 *   line breaks survive;
 *   and the booking number is still the link it always was.
 * ────────────────────────────────────────────────────────────────────────────
 */

const NOTE = "Chauffeur bellen voor levering";

const MULTILINE_NOTE = [
  "Chauffeur bellen voor levering",
  "Poort 4 gebruiken",
  "Papieren meenemen",
].join("\n");

const WITH_NOTE = buildTrip({
  id: "trip-with-note",
  bookingNumber: "ANRDUB2793554",
  internalNotes: NOTE,
});

const WITHOUT_NOTE = buildTrip({
  id: "trip-without-note",
  bookingNumber: "ANRBEL2768902",
  internalNotes: null,
});

function bookingLink(bookingNumber: string): HTMLElement {
  return screen.getByRole("link", { name: bookingNumber });
}

/** The note panel, which is portalled to the body rather than into the row. */
function notePanel(): HTMLElement | null {
  return screen.queryByRole("tooltip");
}

async function showRows(trips = [WITH_NOTE, WITHOUT_NOTE]): Promise<void> {
  respondWith(requestMock, { trips: buildPage(trips) });
  renderRitten();
  await screen.findByText(trips[0].bookingNumber as string);
}

beforeEach(() => {
  requestMock.mockReset();
  window.localStorage.clear();
});

describe("the booking number's notes", () => {
  it("shows the note when the booking number is hovered", async () => {
    await showRows();

    await userEvent.hover(bookingLink("ANRDUB2793554"));

    expect(await screen.findByRole("tooltip")).toHaveTextContent(NOTE);
  });

  it("labels it so a reader knows which field it is", async () => {
    await showRows();

    await userEvent.hover(bookingLink("ANRDUB2793554"));

    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Extra notities",
    );
  });

  it("hides it again when the pointer leaves", async () => {
    await showRows();

    await userEvent.hover(bookingLink("ANRDUB2793554"));
    await screen.findByRole("tooltip");

    await userEvent.unhover(bookingLink("ANRDUB2793554"));

    await waitFor(() => expect(notePanel()).not.toBeInTheDocument());
  });

  /**
   * WCAG 1.4.13 asks that content shown on hover be HOVERABLE: the pointer has
   * to be able to reach it, or a long scrollable note could never be read.
   */
  it("survives the pointer moving onto the note itself", async () => {
    await showRows();

    await userEvent.hover(bookingLink("ANRDUB2793554"));

    const panel = await screen.findByRole("tooltip");

    await userEvent.unhover(bookingLink("ANRDUB2793554"));
    await userEvent.hover(panel);

    expect(notePanel()).toBeInTheDocument();
  });

  describe("without a mouse", () => {
    it("shows the note when the booking number takes focus", async () => {
      await showRows();

      bookingLink("ANRDUB2793554").focus();

      expect(await screen.findByRole("tooltip")).toHaveTextContent(NOTE);
    });

    it("describes the booking number with it, for a screen reader", async () => {
      await showRows();

      bookingLink("ANRDUB2793554").focus();

      const panel = await screen.findByRole("tooltip");

      /*
       * On the LINK itself — the element that takes focus. A wrapper carrying
       * the attribute would be ignored by a screen reader while looking
       * perfectly correct in the markup.
       */
      expect(bookingLink("ANRDUB2793554")).toHaveAttribute(
        "aria-describedby",
        panel.id,
      );
    });

    /** Dismissible without moving the pointer, which WCAG 1.4.13 also asks. */
    it("closes on Escape", async () => {
      await showRows();

      bookingLink("ANRDUB2793554").focus();
      await screen.findByRole("tooltip");

      await userEvent.keyboard("{Escape}");

      await waitFor(() => expect(notePanel()).not.toBeInTheDocument());
    });

    it("hides it again when focus moves away", async () => {
      await showRows();

      bookingLink("ANRDUB2793554").focus();
      await screen.findByRole("tooltip");

      bookingLink("ANRDUB2793554").blur();

      await waitFor(() => expect(notePanel()).not.toBeInTheDocument());
    });
  });

  describe("a Trip with no note", () => {
    it("shows no popup on hover", async () => {
      await showRows();

      await userEvent.hover(bookingLink("ANRBEL2768902"));

      expect(notePanel()).not.toBeInTheDocument();
    });

    it("shows no popup on focus either", async () => {
      await showRows();

      bookingLink("ANRBEL2768902").focus();

      expect(notePanel()).not.toBeInTheDocument();
    });

    /** A note of only whitespace is not a note. */
    it("treats a blank note as no note", async () => {
      await showRows([buildTrip({ bookingNumber: "BLANK", internalNotes: "   " })]);

      await userEvent.hover(bookingLink("BLANK"));

      expect(notePanel()).not.toBeInTheDocument();
    });
  });

  it("shows one row's note and never another's", async () => {
    await showRows([
      WITH_NOTE,
      buildTrip({
        id: "trip-other-note",
        bookingNumber: "ANRXXX0000001",
        internalNotes: "Andere notitie",
      }),
    ]);

    await userEvent.hover(bookingLink("ANRDUB2793554"));

    const panel = await screen.findByRole("tooltip");

    expect(panel).toHaveTextContent(NOTE);
    expect(panel).not.toHaveTextContent("Andere notitie");
  });

  it("keeps the line breaks the operator typed", async () => {
    await showRows([
      buildTrip({ bookingNumber: "MULTILINE", internalNotes: MULTILINE_NOTE }),
    ]);

    await userEvent.hover(bookingLink("MULTILINE"));

    const note = (await screen.findByRole("tooltip")).querySelector("p:last-of-type");

    expect(note).toHaveTextContent("Poort 4 gebruiken");
    // The whole text, newlines and all — not a flattened paragraph.
    expect(note?.textContent).toBe(MULTILINE_NOTE);
    expect(note).toHaveClass("whitespace-pre-wrap");
  });

  /**
   * A long note SCROLLS rather than being cut. Truncating silently would hide
   * text with nothing on screen to say so.
   */
  it("keeps a long note complete and scrollable", async () => {
    const longNote = "Regel met tekst. ".repeat(80);

    await showRows([
      buildTrip({ bookingNumber: "LONG", internalNotes: longNote }),
    ]);

    await userEvent.hover(bookingLink("LONG"));

    const note = (await screen.findByRole("tooltip")).querySelector("p:last-of-type");

    expect(note?.textContent).toBe(longNote);
    expect(note).toHaveClass("overflow-y-auto");
  });

  describe("the booking number itself", () => {
    it("is still a link to the Trip", async () => {
      await showRows();

      expect(bookingLink("ANRDUB2793554")).toHaveAttribute(
        "href",
        "/trips/trip-with-note",
      );
    });

    it("still navigates for a Trip that has no note", async () => {
      await showRows();

      expect(bookingLink("ANRBEL2768902")).toHaveAttribute(
        "href",
        "/trips/trip-without-note",
      );
    });
  });

  /**
   * ── NO N+1 ──────────────────────────────────────────────────────────────
   * The note is a column of the Trip the list already returned. Hovering must
   * not go and ask for it.
   */
  it("asks the backend for nothing, on render or on hover", async () => {
    await showRows();

    const before = requestMock.mock.calls.length;

    await userEvent.hover(bookingLink("ANRDUB2793554"));
    await screen.findByRole("tooltip");

    expect(requestMock.mock.calls).toHaveLength(before);
    expect(
      requestMock.mock.calls.filter((call) => String(call[0]).includes("note")),
    ).toHaveLength(0);
  });

  it("is translated", async () => {
    window.localStorage.setItem("tms.language", "tr");
    await showRows();

    await userEvent.hover(bookingLink("ANRDUB2793554"));

    expect(await screen.findByRole("tooltip")).toHaveTextContent("Ek notlar");
  });

  /**
   * The row is inside a table that scrolls horizontally, and `overflow-x-auto`
   * clips an absolutely positioned child. The note is portalled to the body for
   * exactly that reason, so it must NOT be inside the row.
   */
  it("renders outside the table, so the row cannot clip it", async () => {
    await showRows();

    await userEvent.hover(bookingLink("ANRDUB2793554"));

    const panel = await screen.findByRole("tooltip");
    const row = bookingLink("ANRDUB2793554").closest("tr") as HTMLElement;

    expect(within(row).queryByRole("tooltip")).not.toBeInTheDocument();
    expect(panel.closest("table")).toBeNull();
  });
});
