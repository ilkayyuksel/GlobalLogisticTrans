import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { buildPage, buildPricing, buildTrip, renderRitten, respondWith } from "./ritten-test-support";
import { request } from "@/lib/api/client";
import type { CostConfirmation, Trip } from "@/lib/api/types";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

const requestMock = request as jest.MockedFunction<typeof request>;

/**
 * The sign beside the CC cell that a Trip has SEVERAL confirmations, and the
 * note it opens: each confirmation with its amount, their total and what EK
 * holds. Every figure is the backend's; the page only writes them out.
 */

function confirmation(ccNumber: string, amount: string): CostConfirmation {
  return {
    id: `cc-${ccNumber}`,
    ccNumber,
    costCode: "WAIT",
    amount,
    currency: "EUR",
    receivedAt: "2026-10-27T09:00:00.000Z",
    pdfDocumentId: `pdf-${ccNumber}`,
  };
}

const THREE = [
  confirmation("4261546", "25.00"),
  confirmation("4261545", "70.00"),
  confirmation("4261544", "68.75"),
];

/** A priced Trip whose EK is the backend's `ek` — the confirmations' total unless stated. */
function withConfirmations(
  confirmations: CostConfirmation[],
  total: string | null,
  extra: Partial<Trip> = {},
): Trip {
  return buildTrip({
    costConfirmation: confirmations[0] ?? null,
    costConfirmations: confirmations,
    costConfirmationTotal: total,
    pricing: buildPricing({ ek: total ?? "0.00" }),
    ...extra,
  });
}

describe("several Cost Confirmations on one Trip in Ritten", () => {
  beforeEach(() => {
    requestMock.mockReset();
    window.localStorage.clear();
  });

  async function show(trip: Trip): Promise<void> {
    respondWith(requestMock, { trips: buildPage([trip]) });
    renderRitten();
    await screen.findByRole("table");
  }

  const marker = () => screen.queryByTestId("several-cost-confirmations");

  async function hoverNote(): Promise<string> {
    await userEvent.hover(marker() as HTMLElement);

    return (await screen.findByRole("tooltip")).textContent ?? "";
  }

  it("15. shows no sign for a Trip with one", async () => {
    await show(withConfirmations([THREE[0]], "25.00"));

    expect(await screen.findByText("CC4261546")).toBeInTheDocument();
    expect(marker()).not.toBeInTheDocument();
  });

  it("16. shows a sign in the CC cell for a Trip with several", async () => {
    await show(withConfirmations(THREE, "163.75"));

    const cell = (await screen.findByText("CC4261546")).closest("td") as HTMLElement;

    expect(within(cell).getByTestId("several-cost-confirmations")).toBeInTheDocument();
  });

  it("17/18. on hover lists how many, each number and amount, the total and the EK", async () => {
    await show(withConfirmations(THREE, "163.75"));

    const note = await hoverNote();

    expect(note).toContain("3 CC's gekoppeld");
    expect(note).toContain("CC4261546 — € 25,00");
    expect(note).toContain("CC4261545 — € 70,00");
    expect(note).toContain("CC4261544 — € 68,75");
    expect(note).toContain("CC-totaal: € 163,75");
    expect(note).toContain("EK-bijdrage: € 163,75");
    expect(note).not.toContain("handmatige wachturen");
  });

  it("19. says the confirmations are not in EK when a waiting time is recorded", async () => {
    await show(
      withConfirmations(THREE, "163.75", {
        waitingTimeSupersedesCostConfirmations: true,
        pricing: buildPricing({ ek: "55.00" }),
      }),
    );

    const note = await hoverNote();

    expect(note).toContain("CC-totaal: € 163,75");
    expect(note).toContain("EK-bijdrage: € 55,00 (handmatige wachturen hoger — de CC's tellen niet mee in EK)");
  });

  it("says EK is not priced yet for a Trip that never was", async () => {
    await show(withConfirmations(THREE, "163.75", { pricing: null }));

    expect(await hoverNote()).toContain("EK-bijdrage: nog niet berekend");
  });

  it("is reachable from the keyboard", async () => {
    await show(withConfirmations(THREE, "163.75"));

    (marker() as HTMLElement).focus();

    expect((await screen.findByRole("tooltip")).textContent).toContain("3 CC's gekoppeld");
  });
});
