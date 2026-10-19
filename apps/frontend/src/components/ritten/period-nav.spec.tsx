import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { LanguageProvider } from "@/lib/i18n/language-provider";
import type { RittenView } from "@/lib/ritten/period";
import { ThemeProvider } from "@/lib/theme/theme-provider";

import { PeriodNav } from "./period-nav";

jest.mock("@/lib/calendar/calendar-dates", () => ({
  ...jest.requireActual("@/lib/calendar/calendar-dates"),
  today: () => "2026-10-19",
}));

/**
 * The ISO week of the period on screen, beside the navigator — not beside every
 * Trip's date. It follows every way the period moves.
 */

/** The navigator with the page's own state, so moving it re-renders the week. */
function Navigator({ view, initial }: { view: RittenView; initial: string }) {
  const [anchor, setAnchor] = useState(initial);

  return <PeriodNav view={view} anchor={anchor} onChange={setAnchor} />;
}

function renderNav(view: RittenView, initial: string) {
  render(
    <ThemeProvider>
      <LanguageProvider>
        <Navigator view={view} initial={initial} />
      </LanguageProvider>
    </ThemeProvider>,
  );
}

const week = () => screen.getByLabelText("Weeknummer");

describe("the week number in the period navigator", () => {
  beforeEach(() => window.localStorage.clear());

  it("shows the ISO week of the day on screen", () => {
    renderNav("day", "2026-10-18");

    expect(week()).toHaveTextContent("W42");
  });

  it("follows the next and the previous day across a week's end", async () => {
    renderNav("day", "2026-10-18");

    await userEvent.click(screen.getByRole("button", { name: "Volgende" }));
    expect(week()).toHaveTextContent("W43");

    await userEvent.click(screen.getByRole("button", { name: "Vorige" }));
    expect(week()).toHaveTextContent("W42");
  });

  /** 2026 has 53 weeks; Thursday 7 January 2027 is in week 1 of 2027. */
  it("turns the year on the week's Thursday", async () => {
    renderNav("week", "2026-12-31");

    expect(week()).toHaveTextContent("W53");

    await userEvent.click(screen.getByRole("button", { name: "Volgende" }));
    expect(week()).toHaveTextContent("W1");

    await userEvent.click(screen.getByRole("button", { name: "Vorige" }));
    expect(week()).toHaveTextContent("W53");
  });

  it("follows a picked date", () => {
    renderNav("week", "2026-10-12");

    fireEvent.change(screen.getByLabelText("Kies een dag in de week"), { target: { value: "2027-01-01" } });

    // Friday 1 January 2027 is still week 53 of 2026.
    expect(week()).toHaveTextContent("W53");
  });

  it("goes back to this week's number", async () => {
    renderNav("week", "2026-12-31");

    await userEvent.click(screen.getByRole("button", { name: "Deze week" }));

    expect(week()).toHaveTextContent("W43");
  });

  it("shows no week for a month, which spans several", () => {
    renderNav("month", "2026-10-01");

    expect(screen.queryByLabelText("Weeknummer")).toBeNull();
  });
});
