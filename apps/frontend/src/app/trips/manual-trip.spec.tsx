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

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

jest.mock("@/lib/calendar/calendar-dates", () => ({
  ...jest.requireActual("@/lib/calendar/calendar-dates"),
  today: () => "2026-08-13",
}));

const requestMock = request as jest.MockedFunction<typeof request>;

/**
 * Creating a Trip by hand, from the Ritten page.
 *
 * The rule under test is that NOTHING is required. A Trip entered by hand
 * records a job announced before its paperwork arrived, so the form must accept
 * an empty submission and send nulls — never a placeholder, which would become
 * a string the rest of the business has to recognise and strip.
 */
describe("Manual Trip creation", () => {
  beforeEach(() => {
    requestMock.mockReset();
    window.localStorage.clear();
  });

  async function openForm(): Promise<HTMLElement> {
    respondWith(requestMock, { trips: buildPage([buildTrip()]) });

    renderRitten();
    await screen.findByRole("table");

    await userEvent.click(
      screen.getByRole("button", { name: "+ Nieuwe rit" }),
    );

    return screen.findByRole("dialog");
  }

  /** Only the POST; the page also refetches the list and the counts. */
  function createCall() {
    return mutationCalls(requestMock).find(
      ([path, options]) => path === "/api/v1/trips" && options?.method === "POST",
    );
  }

  it("is offered on the Ritten page", async () => {
    respondWith(requestMock, { trips: buildPage([buildTrip()]) });

    renderRitten();
    await screen.findByRole("table");

    expect(
      screen.getByRole("button", { name: "+ Nieuwe rit" }),
    ).toBeInTheDocument();
  });

  describe("an entirely empty Trip", () => {
    it("can be submitted", async () => {
      const dialog = await openForm();

      await userEvent.click(
        within(dialog).getByRole("button", { name: "Rit aanmaken" }),
      );

      await waitFor(() => expect(createCall()).toBeDefined());
    });

    it("sends null for every field, and no placeholder", async () => {
      const dialog = await openForm();

      await userEvent.click(
        within(dialog).getByRole("button", { name: "Rit aanmaken" }),
      );

      await waitFor(() => expect(createCall()).toBeDefined());

      const [, options] = createCall() as [string, { body?: unknown }];

      expect(options.body).toEqual({
        bookingNumber: null,
        planningDate: null,
        vehicleId: null,
        startTime: null,
        endTime: null,
        containerNumber: null,
        containerType: null,
        terminal: null,
        destinationCity: null,
        destinationCountry: null,
        waitingTimeMinutes: null,
        distanceKm: null,
        internalNotes: null,
      });
      expect(JSON.stringify(options.body)).not.toMatch(
        /MANUAL|UNKNOWN|N\/A|TBD/i,
      );
    });

    it("closes and reports success", async () => {
      const dialog = await openForm();

      await userEvent.click(
        within(dialog).getByRole("button", { name: "Rit aanmaken" }),
      );

      expect(await screen.findByText("Rit aangemaakt")).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
    });

    /**
     * Refetched rather than prepended locally: the row shown must be the one
     * the backend stored, in the position its ordering puts it.
     */
    it("refetches the list instead of inventing a row", async () => {
      const dialog = await openForm();
      const listCallsBefore = requestMock.mock.calls.length;

      await userEvent.click(
        within(dialog).getByRole("button", { name: "Rit aanmaken" }),
      );

      await waitFor(() =>
        expect(requestMock.mock.calls.length).toBeGreaterThan(
          listCallsBefore + 1,
        ),
      );
    });
  });

  describe("filling in what is known", () => {
    it("sends only what was entered", async () => {
      const dialog = await openForm();

      await userEvent.type(
        within(dialog).getByLabelText("Booking"),
        "BK-2026-9001",
      );
      await userEvent.type(within(dialog).getByLabelText("Terminal"), "Quay 869");
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Rit aanmaken" }),
      );

      await waitFor(() => expect(createCall()).toBeDefined());

      const [, options] = createCall() as [string, { body?: never }];

      expect(options.body).toMatchObject({
        bookingNumber: "BK-2026-9001",
        terminal: "Quay 869",
        planningDate: null,
        vehicleId: null,
      });
    });

    it("offers the active vehicles", async () => {
      const dialog = await openForm();

      expect(
        within(within(dialog).getByLabelText("Nummerplaat")).getByRole("option", {
          name: "1-ABC-123",
        }),
      ).toBeInTheDocument();
    });

    it("turns hours and minutes into total minutes", async () => {
      const dialog = await openForm();

      await userEvent.type(within(dialog).getByLabelText("uur"), "2");
      await userEvent.type(within(dialog).getByLabelText("min"), "30");
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Rit aanmaken" }),
      );

      await waitFor(() => expect(createCall()).toBeDefined());

      const [, options] = createCall() as [string, { body?: never }];

      expect(options.body).toMatchObject({ waitingTimeMinutes: 150 });
    });

    /** The shared utility refuses 90 minutes rather than rewriting it to 1h30. */
    it("refuses minutes that do not belong to an hour", async () => {
      const dialog = await openForm();

      await userEvent.type(within(dialog).getByLabelText("min"), "90");

      expect(await within(dialog).findByRole("alert")).toHaveTextContent(
        /0 en 59/,
      );
      expect(
        within(dialog).getByRole("button", { name: "Rit aanmaken" }),
      ).toBeDisabled();
    });
  });

  describe("what the form must not offer", () => {
    /** The driver follows from the vehicle's assignment. */
    it("has no driver selector", async () => {
      const dialog = await openForm();

      expect(
        within(dialog).queryByLabelText(/chauffeur/i),
      ).not.toBeInTheDocument();
    });

    /** Every Trip starts OPEN, through one entry point. */
    it("has no status selector", async () => {
      const dialog = await openForm();

      expect(within(dialog).queryByLabelText(/status/i)).not.toBeInTheDocument();
    });

    it("asks for no PDF", async () => {
      const dialog = await openForm();

      expect(within(dialog).queryByLabelText(/pdf/i)).not.toBeInTheDocument();
    });
  });

  describe("when the backend refuses", () => {
    it("stays open and shows what it said", async () => {
      const dialog = await openForm();

      requestMock.mockRejectedValueOnce(
        new ApiError("CONFLICT", "Dit bookingnummer is al in gebruik.", 409),
      );

      await userEvent.type(
        within(dialog).getByLabelText("Booking"),
        "BK-2026-9001",
      );
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Rit aanmaken" }),
      );

      expect(await within(dialog).findByRole("alert")).toHaveTextContent(
        "Dit bookingnummer is al in gebruik.",
      );
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("keeps what was typed", async () => {
      const dialog = await openForm();

      requestMock.mockRejectedValueOnce(
        new ApiError("CONFLICT", "Bezet.", 409),
      );

      await userEvent.type(
        within(dialog).getByLabelText("Booking"),
        "BK-2026-9001",
      );
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Rit aanmaken" }),
      );

      await within(dialog).findByRole("alert");

      expect(within(dialog).getByLabelText("Booking")).toHaveValue(
        "BK-2026-9001",
      );
    });
  });
});
