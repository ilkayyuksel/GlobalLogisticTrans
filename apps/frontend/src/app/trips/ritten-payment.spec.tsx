import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { request } from "@/lib/api/client";
import type { Trip } from "@/lib/api/types";
import {
  buildPage,
  buildTrip,
  lastListCall,
  listCalls,
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
 * BETAALD / NIET BETAALD, from the Ritten list.
 *
 * ── WHAT THESE TESTS GUARD ──────────────────────────────────────────────────
 *   both states are LABELLED. "Not paid yet" is what an operator scans for, so
 *     an absent badge would be indistinguishable from one that failed;
 *   the badge is the toggle, it saves at once, and it asks nothing first;
 *   the row updates FROM THE RESPONSE — no list refetch, so the selection, the
 *     filters, the page and the period all survive;
 *   only the row that was clicked changes;
 *   payment never touches the lifecycle: every status keeps its own badge
 *     through the toggle, and the request carries a boolean and nothing else;
 *   the filter is sent to the BACKEND, and "Alle" sends nothing at all.
 * ────────────────────────────────────────────────────────────────────────────
 */

const UNPAID = buildTrip({
  id: "trip-unpaid",
  bookingNumber: "ANRDUB2602247",
  isPaid: false,
});

const PAID = buildTrip({
  id: "trip-paid",
  bookingNumber: "ANRBEL2768902",
  isPaid: true,
});

/** The row a booking number belongs to. */
async function rowOf(bookingNumber: string): Promise<HTMLElement> {
  return (await screen.findByText(bookingNumber)).closest("tr") as HTMLElement;
}

/** The payment toggle of one row, by what clicking it would DO. */
async function paymentToggle(
  bookingNumber: string,
  action: "Markeer als betaald" | "Markeer als niet betaald",
): Promise<HTMLElement> {
  return within(await rowOf(bookingNumber)).getByRole("button", {
    name: `${action} ${bookingNumber}`,
  });
}

/** Every PATCH the page sent to the payment endpoint. */
function paymentCalls() {
  return mutationCalls(requestMock).filter(([path]) =>
    String(path).endsWith("/payment"),
  );
}

async function showRows(
  trips: Trip[] = [UNPAID, PAID],
  onTripUpdate?: (update: {
    tripId: string;
    body: Record<string, unknown>;
  }) => Trip,
): Promise<void> {
  respondWith(requestMock, {
    trips: buildPage(trips),
    onTripUpdate:
      onTripUpdate ??
      (({ tripId, body }) => {
        const trip = trips.find((candidate) => candidate.id === tripId) as Trip;

        return { ...trip, isPaid: body.isPaid as boolean };
      }),
  });

  renderRitten();
  await screen.findByText(trips[0].bookingNumber as string);
}

beforeEach(() => {
  requestMock.mockReset();
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});

describe("the payment badge", () => {
  it("labels an unpaid Trip NIET BETAALD", async () => {
    await showRows();

    expect(await rowOf("ANRDUB2602247")).toHaveTextContent("Niet betaald");
  });

  it("labels a paid Trip BETAALD", async () => {
    await showRows();

    expect(within(await rowOf("ANRBEL2768902")).getByText("Betaald")).toBeInTheDocument();
  });

  /**
   * ── PAYMENT NOW CARRIES A COLOUR ──────────────────────────────────────────
   * It used `outline` so it could not be mistaken for a lifecycle badge. That
   * was overruled: payment is what an operator scans a long list for, and a row
   * of identical outlines makes them read every word.
   *
   * The tones come from the same semantic set as everywhere else, and the one
   * genuinely dangerous confusion is still avoided — an unpaid Trip is
   * `warning`, never `danger`, because `danger` means CANCELLED.
   */
  it("shows a paid Trip in the settled tone", async () => {
    await showRows();

    const badge = await paymentToggle(
      "ANRBEL2768902",
      "Markeer als niet betaald",
    );

    expect(badge.className).toContain("bg-success/10");
  });

  it("shows an unpaid Trip as a warning, never as a cancellation", async () => {
    await showRows([buildTrip({ isPaid: false })]);

    const badge = await paymentToggle("ANRDUB2602247", "Markeer als betaald");

    expect(badge.className).toContain("bg-warning/10");
    expect(badge.className).not.toMatch(/bg-danger/);
  });

  it("sits beside the lifecycle badge rather than replacing it", async () => {
    await showRows([buildTrip({ status: "CLOSED", isPaid: true })]);

    const row = await rowOf("ANRDUB2602247");

    expect(within(row).getByText("Afgewerkt")).toBeInTheDocument();
    expect(within(row).getByText("Betaald")).toBeInTheDocument();
  });
});

describe("toggling payment", () => {
  it("is a direct button on the row, with no dialog in front of it", async () => {
    await showRows();

    await userEvent.click(
      await paymentToggle("ANRDUB2602247", "Markeer als betaald"),
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(paymentCalls()).toHaveLength(1);
  });

  it("sends a boolean and nothing else", async () => {
    await showRows();

    await userEvent.click(
      await paymentToggle("ANRDUB2602247", "Markeer als betaald"),
    );

    const [path, options] = paymentCalls()[0];

    expect(path).toBe("/api/v1/trips/trip-unpaid/payment");
    expect(options?.method).toBe("PATCH");
    expect(options?.body).toEqual({ isPaid: true });
  });

  it("takes it back off again", async () => {
    await showRows();

    await userEvent.click(
      await paymentToggle("ANRBEL2768902", "Markeer als niet betaald"),
    );

    expect(paymentCalls()[0][1]?.body).toEqual({ isPaid: false });
  });

  it("updates the row from the response", async () => {
    await showRows();

    await userEvent.click(
      await paymentToggle("ANRDUB2602247", "Markeer als betaald"),
    );

    await waitFor(async () =>
      expect(
        within(await rowOf("ANRDUB2602247")).getByText("Betaald"),
      ).toBeInTheDocument(),
    );
  });

  /**
   * ── NO LIST REFETCH ─────────────────────────────────────────────────────
   * The endpoint answered with the whole Trip and payment cannot move a row, so
   * refetching would throw away an answer already in hand and rearrange the
   * page under an operator working through it.
   */
  it("does not reload the list", async () => {
    await showRows();

    const before = listCalls(requestMock).length;

    await userEvent.click(
      await paymentToggle("ANRDUB2602247", "Markeer als betaald"),
    );
    await screen.findByText("Rit gemarkeerd als betaald");

    expect(listCalls(requestMock)).toHaveLength(before);
  });

  it("leaves every other row exactly as it was", async () => {
    await showRows();

    await userEvent.click(
      await paymentToggle("ANRDUB2602247", "Markeer als betaald"),
    );
    await screen.findByText("Rit gemarkeerd als betaald");

    expect(
      within(await rowOf("ANRBEL2768902")).getByText("Betaald"),
    ).toBeInTheDocument();
    expect(paymentCalls()).toHaveLength(1);
    expect(paymentCalls()[0][0]).not.toContain("trip-paid");
  });

  it("keeps the operator's selection", async () => {
    await showRows();

    const checkbox = within(await rowOf("ANRBEL2768902")).getByRole("checkbox");

    await userEvent.click(checkbox);
    await userEvent.click(
      await paymentToggle("ANRDUB2602247", "Markeer als betaald"),
    );
    await screen.findByText("Rit gemarkeerd als betaald");

    expect(checkbox).toBeChecked();
  });

  it("keeps the filters exactly where they were", async () => {
    await showRows();

    await userEvent.selectOptions(
      screen.getByLabelText("Terminal"),
      "PSA Quay 869",
    );
    await waitFor(() =>
      expect(lastListCall(requestMock).terminal).toBe("PSA Quay 869"),
    );

    await userEvent.click(
      await paymentToggle("ANRDUB2602247", "Markeer als betaald"),
    );
    await screen.findByText("Rit gemarkeerd als betaald");

    expect(screen.getByLabelText("Terminal")).toHaveValue("PSA Quay 869");
  });

  it("reports the backend's own wording when it refuses", async () => {
    await showRows();
    requestMock.mockRejectedValueOnce(new Error("nope"));

    await userEvent.click(
      await paymentToggle("ANRDUB2602247", "Markeer als betaald"),
    );

    expect(await screen.findByText(/Actie mislukt/)).toBeInTheDocument();
  });
});

/**
 * ── PAYMENT AND THE LIFECYCLE ARE INDEPENDENT ─────────────────────────────
 * Every combination is reachable and none of them is special. The badge pair on
 * the row proves the two are shown side by side; the request proves nothing but
 * the boolean was sent, so no status could travel with it.
 */
describe("payment and status together", () => {
  const STATUSES = [
    ["OPEN", "Open"],
    ["CLOSED", "Afgewerkt"],
    ["CANCELLED", "Geannuleerd"],
  ] as const;

  it.each(STATUSES)("shows %s + NIET BETAALD", async (status, label) => {
    await showRows([buildTrip({ status, isPaid: false })]);

    const row = await rowOf("ANRDUB2602247");

    expect(within(row).getByText(label)).toBeInTheDocument();
    expect(within(row).getByText("Niet betaald")).toBeInTheDocument();
  });

  it.each(STATUSES)("shows %s + BETAALD", async (status, label) => {
    await showRows([buildTrip({ status, isPaid: true })]);

    const row = await rowOf("ANRDUB2602247");

    expect(within(row).getByText(label)).toBeInTheDocument();
    expect(within(row).getByText("Betaald")).toBeInTheDocument();
  });

  it.each(STATUSES)(
    "keeps a %s Trip in that status through the toggle",
    async (status, label) => {
      await showRows([buildTrip({ status, isPaid: false })]);

      await userEvent.click(
        await paymentToggle("ANRDUB2602247", "Markeer als betaald"),
      );
      await screen.findByText("Rit gemarkeerd als betaald");

      const row = await rowOf("ANRDUB2602247");

      expect(within(row).getByText(label)).toBeInTheDocument();
      expect(within(row).getByText("Betaald")).toBeInTheDocument();
    },
  );

  it("never sends a status with a payment change", async () => {
    await showRows();

    await userEvent.click(
      await paymentToggle("ANRDUB2602247", "Markeer als betaald"),
    );

    expect(Object.keys(paymentCalls()[0][1]?.body as object)).toEqual([
      "isPaid",
    ]);
  });

  it("uses the payment endpoint, never the status one", async () => {
    await showRows();

    await userEvent.click(
      await paymentToggle("ANRDUB2602247", "Markeer als betaald"),
    );

    expect(
      mutationCalls(requestMock).filter(([path]) =>
        String(path).endsWith("/status"),
      ),
    ).toHaveLength(0);
  });
});

/**
 * ── THE FILTER IS THE BACKEND'S ───────────────────────────────────────────
 * Nothing is filtered in the browser. A browser-side filter would apply only to
 * the page in view and would look like it worked while ignoring the rest of the
 * period — and it would leave the counts describing a different set.
 */
describe("the payment filter", () => {
  function paymentFilter(): HTMLElement {
    return screen.getByRole("radiogroup", { name: "Betaling" });
  }

  async function choose(label: string): Promise<void> {
    await userEvent.click(within(paymentFilter()).getByRole("radio", { name: label }));
  }

  it("offers Alle, Betaald and Niet betaald", async () => {
    await showRows();

    expect(
      within(paymentFilter())
        .getAllByRole("radio")
        .map((option) => option.textContent),
    ).toEqual(["Alle", "Betaald", "Niet betaald"]);
  });

  it("sends no payment parameter for Alle", async () => {
    await showRows();

    expect(lastListCall(requestMock).isPaid).toBeUndefined();
  });

  it("asks the backend for the paid Trips", async () => {
    await showRows();

    await choose("Betaald");

    await waitFor(() => expect(lastListCall(requestMock).isPaid).toBe(true));
  });

  /*
   * `false`, not an absent parameter: "Niet betaald" is a real question, and
   * dropping it would quietly return everything.
   */
  it("asks the backend for the unpaid Trips", async () => {
    await showRows();

    await choose("Niet betaald");

    await waitFor(() => expect(lastListCall(requestMock).isPaid).toBe(false));
  });

  it("goes back to no parameter at all on Alle", async () => {
    await showRows();

    await choose("Betaald");
    await waitFor(() => expect(lastListCall(requestMock).isPaid).toBe(true));

    await choose("Alle");

    await waitFor(() =>
      expect(lastListCall(requestMock).isPaid).toBeUndefined(),
    );
  });

  it("combines with the lifecycle filter rather than replacing it", async () => {
    await showRows();

    await userEvent.click(
      within(screen.getByRole("radiogroup", { name: "Status" })).getByRole(
        "radio",
        { name: "Afgewerkt" },
      ),
    );
    await choose("Niet betaald");

    await waitFor(() =>
      expect(lastListCall(requestMock)).toMatchObject({
        status: "CLOSED",
        isPaid: false,
      }),
    );
  });

  it("combines with the search and the other filters", async () => {
    await showRows();

    await choose("Betaald");
    await userEvent.selectOptions(
      screen.getByLabelText("Terminal"),
      "PSA Quay 869",
    );

    await waitFor(() =>
      expect(lastListCall(requestMock)).toMatchObject({
        isPaid: true,
        terminal: "PSA Quay 869",
      }),
    );
  });

  it("keeps the period, so week and month still ask for their own range", async () => {
    await showRows();

    await userEvent.click(screen.getByRole("radio", { name: "Week" }));
    await choose("Betaald");

    await waitFor(() => {
      const call = lastListCall(requestMock);

      expect(call.isPaid).toBe(true);
      expect(call.planningDateFrom).toBeDefined();
      expect(call.planningDateTo).toBeDefined();
    });
  });

  it("counts as an active filter, so it can be cleared", async () => {
    await showRows();

    await choose("Betaald");

    await userEvent.click(screen.getByRole("button", { name: "Filters wissen" }));

    await waitFor(() =>
      expect(lastListCall(requestMock).isPaid).toBeUndefined(),
    );
  });
});

describe("in the other language and theme", () => {
  it("is translated", async () => {
    respondWith(requestMock, { trips: buildPage([UNPAID, PAID]) });
    renderRitten({ language: "tr" });
    await screen.findByText("ANRDUB2602247");

    expect(
      within(await rowOf("ANRDUB2602247")).getByText("Ödenmedi"),
    ).toBeInTheDocument();
    expect(
      within(await rowOf("ANRBEL2768902")).getByText("Ödendi"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radiogroup", { name: "Ödeme" }),
    ).toBeInTheDocument();
  });

  it("names the action in Turkish too", async () => {
    respondWith(requestMock, { trips: buildPage([UNPAID]) });
    renderRitten({ language: "tr" });
    await screen.findByText("ANRDUB2602247");

    expect(
      screen.getByRole("button", {
        name: "Ödendi olarak işaretle ANRDUB2602247",
      }),
    ).toBeInTheDocument();
  });

  /*
   * The badge carries design TOKENS rather than literal colours, so both themes
   * are served by one definition — asserting the token is asserting both.
   */
  it.each(["light", "dark"] as const)("renders in %s mode", async (theme) => {
    respondWith(requestMock, { trips: buildPage([UNPAID, PAID]) });
    renderRitten({ theme });
    await screen.findByText("ANRDUB2602247");

    const badge = within(await rowOf("ANRBEL2768902")).getByText("Betaald");

    expect(badge.className).toContain("bg-success/10");
    expect(badge.className).toContain("text-success");
    expect(badge.className).not.toMatch(/#|rgb\(/);
  });
});
