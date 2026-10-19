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
const EDIT = "Boekingsnummer wijzigen";

/**
 * Correcting the booking number from the Ritten list: a pencil directly right
 * of the number, the same inline editor every other field uses.
 *
 * Whether the new number is free is the BACKEND's decision; these tests only
 * prove what is sent and that its refusal reaches the operator unchanged.
 */
describe("editing the booking number in the Ritten list", () => {
  beforeEach(() => {
    requestMock.mockReset();
    window.localStorage.clear();
  });

  async function showTrip() {
    respondWith(requestMock, { trips: buildPage([buildTrip()]) });
    renderRitten();
    await screen.findByRole("table");
  }

  function patchCalls() {
    return mutationCalls(requestMock).filter(
      ([path, options]) => options?.method === "PATCH" && path === "/api/v1/trips/trip-1",
    );
  }

  async function typeBookingNumber(value: string): Promise<void> {
    await userEvent.click(screen.getByRole("button", { name: EDIT }));

    const input = screen.getByLabelText(EDIT);

    await userEvent.clear(input);
    if (value !== "") {
      await userEvent.type(input, value);
    }
    await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));
  }

  it("offers the pencil beside the number, the link and copy button untouched", async () => {
    await showTrip();

    const row = screen.getByRole("link", { name: "ANRDUB2602247" }).closest("tr") as HTMLElement;

    expect(within(row).getByRole("button", { name: EDIT })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Boekingsnummer kopiëren" })).toBeInTheDocument();
  });

  it("opens with the current number", async () => {
    await showTrip();
    await userEvent.click(screen.getByRole("button", { name: EDIT }));

    expect(screen.getByLabelText(EDIT)).toHaveValue("ANRDUB2602247");
  });

  it("sends only the new, trimmed booking number and confirms it", async () => {
    await showTrip();
    await typeBookingNumber("  ANRDUB2601111 ");

    await waitFor(() => expect(patchCalls()).toHaveLength(1));
    expect(patchCalls()[0][1]?.body).toEqual({ bookingNumber: "ANRDUB2601111" });
    expect(await screen.findByText(/Rit bijgewerkt/)).toBeInTheDocument();
  });

  it("refuses to send an empty booking number", async () => {
    await showTrip();
    await typeBookingNumber("");

    expect(await screen.findByText("Dit veld is verplicht.")).toBeInTheDocument();
    expect(patchCalls()).toHaveLength(0);
  });

  it("shows the backend's refusal of a duplicate in the open editor", async () => {
    const message =
      "Er bestaat al een rit met boekingsnummer ANRDUB2609999 met container CNEU4522970 op dezelfde datum. De wijziging is niet opgeslagen.";

    await showTrip();
    const original = requestMock.getMockImplementation();
    requestMock.mockImplementation((...args: unknown[]) => {
      const [, options] = args as [string, { method?: string }];

      return options?.method === "PATCH"
        ? Promise.reject(new ApiError("CONFLICT", message, 409))
        : (original as (...called: unknown[]) => Promise<unknown>)(...args);
    });

    await typeBookingNumber("ANRDUB2609999");

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByLabelText(EDIT)).toHaveValue("ANRDUB2609999");
  });
});
