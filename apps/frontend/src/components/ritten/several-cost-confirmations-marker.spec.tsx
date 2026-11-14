import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { buildPricing, buildTrip } from "@/app/trips/ritten-test-support";
import type { CostConfirmation, Trip } from "@/lib/api/types";
import { LanguageProvider } from "@/lib/i18n/language-provider";
import { SeveralCostConfirmationsMarker } from "./several-cost-confirmations-marker";

/**
 * 20. The sign and its note follow the Trip they are given, and nothing else:
 * a confirmation added or removed reaches them with the next Trip the list
 * returns, because they hold no state of their own.
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

function tripWith(confirmations: CostConfirmation[], total: string | null): Trip {
  return buildTrip({
    costConfirmation: confirmations[0] ?? null,
    costConfirmations: confirmations,
    costConfirmationTotal: total,
    pricing: buildPricing({ ek: total ?? "0.00" }),
  });
}

const TWO = [confirmation("4261545", "70.00"), confirmation("4261544", "68.75")];
const THREE = [confirmation("4261546", "25.00"), ...TWO];

function renderFor(trip: Trip) {
  const view = render(
    <LanguageProvider>
      <SeveralCostConfirmationsMarker trip={trip} />
    </LanguageProvider>,
  );

  return {
    rerenderFor: (next: Trip) =>
      view.rerender(
        <LanguageProvider>
          <SeveralCostConfirmationsMarker trip={next} />
        </LanguageProvider>,
      ),
  };
}

async function noteText(): Promise<string> {
  await userEvent.hover(screen.getByTestId("several-cost-confirmations"));

  return (await screen.findByRole("tooltip")).textContent ?? "";
}

describe("the several-confirmations sign, as its Trip changes", () => {
  beforeEach(() => window.localStorage.clear());

  it("20. counts a confirmation added since, with the new total", async () => {
    const { rerenderFor } = renderFor(tripWith(TWO, "138.75"));
    expect(await noteText()).toContain("2 CC's gekoppeld");
    await userEvent.unhover(screen.getByTestId("several-cost-confirmations"));

    rerenderFor(tripWith(THREE, "163.75"));

    const note = await noteText();
    expect(note).toContain("3 CC's gekoppeld");
    expect(note).toContain("CC4261546 — € 25,00");
    expect(note).toContain("CC-totaal: € 163,75");
  });

  it("20. disappears when the Trip is down to one", () => {
    const { rerenderFor } = renderFor(tripWith(TWO, "138.75"));
    expect(screen.getByTestId("several-cost-confirmations")).toBeInTheDocument();

    rerenderFor(tripWith([TWO[0]], "70.00"));

    expect(screen.queryByTestId("several-cost-confirmations")).not.toBeInTheDocument();
  });
});
