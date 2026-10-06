import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  buildPage,
  buildTrip,
  mutationCalls,
  renderRitten,
  respondWith,
} from "./ritten-test-support";
import { request } from "@/lib/api/client";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

const requestMock = request as jest.MockedFunction<typeof request>;

/**
 * The address in the Ritten list: terminal and destination, editable inline.
 *
 * Editable on EVERY Trip — imported ones included, by decision of the
 * business — and read-only only once DELETED. The backend reprices a CLOSED
 * Trip after either end changes; nothing here computes money.
 */

const TERMINAL = "Terminal wijzigen";
const DESTINATION = "Bestemming (stad, land)";

/** An imported Trip, which the document used to own the address of. */
const IMPORTED = { pdfDocumentId: "pdf-1" } as const;

async function showTrips(trips = [buildTrip(IMPORTED)]): Promise<void> {
  respondWith(requestMock, { trips: buildPage(trips) });
  renderRitten();
  await screen.findByRole("table");
}

function patches() {
  return mutationCalls(requestMock).filter(
    ([, options]) => (options as { method?: string } | undefined)?.method === "PATCH",
  );
}

async function retype(label: string, value: string): Promise<void> {
  await userEvent.click(screen.getByRole("button", { name: label }));
  await userEvent.clear(screen.getByLabelText(label));
  await userEvent.type(screen.getByLabelText(label), value);
}

describe("the address in the Ritten list", () => {
  beforeEach(() => {
    requestMock.mockReset();
    window.localStorage.clear();
  });

  it("saves a new terminal on an imported Trip", async () => {
    await showTrips();

    await retype(TERMINAL, "DP World Antwerp Gateway");
    await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

    await waitFor(() => expect(patches()).toHaveLength(1));

    const [path, options] = patches()[0] as [string, { body: unknown }];

    expect(path).toBe("/api/v1/trips/trip-1");
    expect(options.body).toEqual({ terminal: "DP World Antwerp Gateway" });
  });

  it("saves a new destination on an imported Trip", async () => {
    await showTrips();

    await retype(DESTINATION, "Saint-Étienne, France");
    await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

    await waitFor(() => expect(patches()).toHaveLength(1));
    expect((patches()[0][1] as { body: unknown }).body).toEqual({
      destinationCity: "Saint-Étienne",
      destinationCountry: "France",
    });
  });

  /** Emptied is "no terminal", which the backend spells null. */
  it("clears the terminal when emptied", async () => {
    await showTrips();

    await userEvent.click(screen.getByRole("button", { name: TERMINAL }));
    await userEvent.clear(screen.getByLabelText(TERMINAL));
    await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

    await waitFor(() => expect(patches()).toHaveLength(1));
    expect((patches()[0][1] as { body: unknown }).body).toEqual({ terminal: null });
  });

  it("keeps the old terminal on cancel and sends nothing", async () => {
    await showTrips();

    await retype(TERMINAL, "Elsewhere");
    await userEvent.click(screen.getByRole("button", { name: "Annuleren" }));

    expect(patches()).toHaveLength(0);
    expect(screen.getByRole("button", { name: TERMINAL })).toHaveTextContent(
      buildTrip().terminal as string,
    );
  });

  it("patches only the Trip that was edited", async () => {
    await showTrips([
      buildTrip(IMPORTED),
      buildTrip({ ...IMPORTED, id: "trip-2", bookingNumber: "BK-OTHER" }),
    ]);

    const [first] = screen.getAllByRole("button", { name: TERMINAL });
    await userEvent.click(first);
    await userEvent.clear(screen.getByRole("textbox", { name: TERMINAL }));
    await userEvent.type(screen.getByRole("textbox", { name: TERMINAL }), "Quay 1742");
    await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0][0]).toBe("/api/v1/trips/trip-1");
  });

  it("stays read-only on a DELETED Trip", async () => {
    await showTrips([buildTrip({ ...IMPORTED, status: "DELETED" })]);

    expect(screen.queryByRole("button", { name: TERMINAL })).toBeNull();
    expect(screen.queryByRole("button", { name: DESTINATION })).toBeNull();
  });
});
