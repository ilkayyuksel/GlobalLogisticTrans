import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError, request } from "@/lib/api/client";
import {
  buildPage,
  buildTrip,
  mutationCalls,
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
 * Editing a Trip's internal notes from the Ritten list.
 *
 * ── WHAT THESE TESTS GUARD ──────────────────────────────────────────────────
 * The pencil is a SECOND DOOR onto one field, not a second field. So the tests
 * are mostly about things NOT changing:
 *
 *   it writes `internalNotes` through `PATCH /api/v1/trips/:id` — the very
 *     request the Trip detail page makes, with the same body;
 *   the booking number is still a link, the copy button still only copies, and
 *     neither the pencil nor the copy navigates anywhere;
 *   the hover note survives, and shows the NEW text straight after a save
 *     without the list being fetched again;
 *   and a refusal keeps the dialog open with the typed text still in it, so a
 *     note is never lost to a failed save.
 * ────────────────────────────────────────────────────────────────────────────
 */

const EXISTING_NOTE = "Chauffeur bellen voor levering";

const WITH_NOTE = buildTrip({
  id: "trip-with-note",
  bookingNumber: "ANRDUB2793554",
  internalNotes: EXISTING_NOTE,
});

const WITHOUT_NOTE = buildTrip({
  id: "trip-without-note",
  bookingNumber: "ANRBEL2768902",
  internalNotes: null,
});

function editButton(bookingNumber: string): HTMLElement {
  return screen.getByRole("button", {
    name: `Interne notities bewerken ${bookingNumber}`,
  });
}

function noteBox(): HTMLTextAreaElement {
  return screen.getByRole("textbox", { name: "Interne notities" });
}

function bookingLink(bookingNumber: string): HTMLElement {
  return screen.getByRole("link", { name: bookingNumber });
}

/** Every PATCH the page sent to a Trip. */
function tripPatches(): { tripId: string; body: Record<string, unknown> }[] {
  return mutationCalls(requestMock)
    .filter(
      ([path, options]) =>
        options?.method === "PATCH" && /^\/api\/v1\/trips\/[^/]+$/.test(path),
    )
    .map(([path, options]) => ({
      tripId: path.replace("/api/v1/trips/", ""),
      body: (options?.body ?? {}) as Record<string, unknown>,
    }));
}

async function showRows(trips = [WITH_NOTE, WITHOUT_NOTE]): Promise<void> {
  respondWith(requestMock, {
    trips: buildPage(trips),
    // The backend answers a PATCH with the WHOLE updated Trip, and the page is
    // required to take the note from that answer rather than from what was
    // typed. Echoing the body back is exactly what the real endpoint does.
    onTripUpdate: ({ tripId, body }) => ({
      ...(trips.find((trip) => trip.id === tripId) ?? trips[0]),
      ...body,
    }),
  });
  renderRitten();
  await screen.findByText(trips[0].bookingNumber as string);
}

beforeEach(() => {
  requestMock.mockReset();
  window.localStorage.clear();
});

describe("editing the notes from the list", () => {
  it("offers a pencil on a Trip", async () => {
    await showRows();

    expect(editButton("ANRDUB2793554")).toBeInTheDocument();
  });

  it("opens a dialog when the pencil is clicked", async () => {
    await showRows();

    await userEvent.click(editButton("ANRDUB2793554"));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("loads the existing note into the box", async () => {
    await showRows();

    await userEvent.click(editButton("ANRDUB2793554"));

    expect(noteBox()).toHaveValue(EXISTING_NOTE);
  });

  /** An empty note is not an error, and the box simply opens empty. */
  it("opens empty on a Trip with no note, and takes one", async () => {
    await showRows();

    await userEvent.click(editButton("ANRBEL2768902"));
    expect(noteBox()).toHaveValue("");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await userEvent.type(noteBox(), "Poort 4");

    expect(noteBox()).toHaveValue("Poort 4");
  });

  it("saves through the Trip update endpoint the detail page uses", async () => {
    await showRows();

    await userEvent.click(editButton("ANRDUB2793554"));
    await userEvent.clear(noteBox());
    await userEvent.type(noteBox(), "Nieuwe instructie");
    await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

    await waitFor(() => expect(tripPatches()).toHaveLength(1));
    expect(tripPatches()[0]).toEqual({
      tripId: "trip-with-note",
      body: { internalNotes: "Nieuwe instructie" },
    });
  });

  it("changes an existing note", async () => {
    await showRows();

    await userEvent.click(editButton("ANRDUB2793554"));
    await userEvent.clear(noteBox());
    await userEvent.type(noteBox(), "Gewijzigd");
    await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

    await waitFor(() =>
      expect(tripPatches()[0].body).toEqual({ internalNotes: "Gewijzigd" }),
    );
  });

  it("closes the dialog once the save succeeded", async () => {
    await showRows();

    await userEvent.click(editButton("ANRDUB2793554"));
    await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("writes nothing when it is cancelled", async () => {
    await showRows();

    await userEvent.click(editButton("ANRDUB2793554"));
    await userEvent.clear(noteBox());
    await userEvent.type(noteBox(), "Niet opslaan");
    await userEvent.click(screen.getByRole("button", { name: "Annuleren" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(tripPatches()).toHaveLength(0);
  });

  /**
   * The whole point of the row patch: the note the hover shows afterwards comes
   * from the backend's answer, and the list is NOT fetched again.
   */
  describe("after a successful save", () => {
    async function saveNewNote(text: string): Promise<void> {
      await showRows();

      await userEvent.click(editButton("ANRDUB2793554"));
      await userEvent.clear(noteBox());
      await userEvent.type(noteBox(), text);
      await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
    }

    it("shows the new note on hover", async () => {
      await saveNewNote("Poort 4 gebruiken");

      await userEvent.hover(bookingLink("ANRDUB2793554"));

      expect(await screen.findByRole("tooltip")).toHaveTextContent(
        "Poort 4 gebruiken",
      );
    });

    it("does not refetch the whole list", async () => {
      const listsBefore = () =>
        requestMock.mock.calls.filter(([path]) => path === "/api/v1/trips")
          .length;

      await showRows();
      const before = listsBefore();

      await userEvent.click(editButton("ANRDUB2793554"));
      await userEvent.clear(noteBox());
      await userEvent.type(noteBox(), "Zonder refetch");
      await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
      expect(listsBefore()).toBe(before);
    });
  });

  /** A note that has never been set shows no panel, exactly as before. */
  it("leaves the empty-note hover alone", async () => {
    await showRows();

    await userEvent.hover(bookingLink("ANRBEL2768902"));

    await waitFor(() =>
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument(),
    );
  });

  describe("the other controls on the booking number", () => {
    it("still navigates when the booking number itself is clicked", async () => {
      await showRows();

      expect(bookingLink("ANRDUB2793554")).toHaveAttribute(
        "href",
        "/trips/trip-with-note",
      );
    });

    it("does not navigate when the pencil is clicked", async () => {
      await showRows();

      await userEvent.click(editButton("ANRDUB2793554"));

      // Still on the list, with the dialog over it.
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
      expect(bookingLink("ANRDUB2793554")).toBeInTheDocument();
    });

    it("still copies, and only copies, from the copy button", async () => {
      const writeText = jest.fn().mockResolvedValue(undefined);

      await showRows();
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });

      await userEvent.click(
        screen.getAllByRole("button", { name: "Boekingsnummer kopiëren" })[0],
      );

      expect(writeText).toHaveBeenCalledWith("ANRDUB2793554");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(tripPatches()).toHaveLength(0);
    });
  });

  describe("when the backend refuses", () => {
    async function refuse(): Promise<void> {
      respondWith(requestMock, {
        trips: buildPage([WITH_NOTE]),
        onTripUpdate: () => {
          throw new ApiError("VALIDATION_FAILED", "Notitie te lang.", 400);
        },
      });
      renderRitten();
      await screen.findByText("ANRDUB2793554");

      await userEvent.click(editButton("ANRDUB2793554"));
      await userEvent.clear(noteBox());
      await userEvent.type(noteBox(), "Te lang");
      await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));
    }

    it("keeps the dialog open and says why", async () => {
      await refuse();

      expect(await screen.findByRole("dialog")).toBeInTheDocument();
      expect(
        await screen.findByText("Notitie te lang.", { selector: "*" }),
      ).toBeInTheDocument();
    });

    it("keeps what was typed so it can be corrected", async () => {
      await refuse();

      await waitFor(() => expect(noteBox()).toHaveValue("Te lang"));
    });
  });

  /**
   * The dialog and the detail page write the SAME field through the SAME
   * request, which is the guarantee that they cannot drift apart.
   */
  it("sends the field the detail page sends", async () => {
    await showRows();

    await userEvent.click(editButton("ANRDUB2793554"));
    await userEvent.clear(noteBox());
    await userEvent.type(noteBox(), "Gedeeld veld");
    await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

    await waitFor(() => expect(tripPatches()).toHaveLength(1));

    const [call] = mutationCalls(requestMock);

    expect(call[0]).toBe("/api/v1/trips/trip-with-note");
    expect(call[1]?.method).toBe("PATCH");
    expect(Object.keys(call[1]?.body as object)).toEqual(["internalNotes"]);
  });
});
