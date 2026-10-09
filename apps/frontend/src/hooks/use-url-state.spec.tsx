import { act, render, screen } from "@testing-library/react";
import { StrictMode } from "react";

import { useResetOnChange } from "./use-reset-on-change";
import { useUrlState } from "./use-url-state";
import { readEntryKey, stampEntryKey } from "@/lib/navigation/history-entry";
import { choiceParam, dateParam, textParam } from "@/lib/navigation/url-state-codecs";

/**
 * G. View state kept in the address, so Back returns to the same list.
 *
 * Read once on mount, written by REPLACING the current entry on change, never
 * on mount, and never as a new history entry.
 */

const VIEW = choiceParam("view", ["day", "week", "month"] as const, "day");
const SEARCH = textParam("search");
const DATE = dateParam("date", () => "2026-10-09");

let setView: (view: "day" | "week" | "month") => void;
let setSearch: (search: string) => void;

function ViewState() {
  const [view, changeView] = useUrlState(VIEW);
  const [search, changeSearch] = useUrlState(SEARCH);
  const [date] = useUrlState(DATE);
  setView = changeView;
  setSearch = changeSearch;

  return <p>{`${view}|${search}|${date}`}</p>;
}

function at(url: string): void {
  window.history.replaceState({ __NA: true }, "", url);
}

describe("useUrlState", () => {
  it("reads the state the address carries", () => {
    at("/trips?view=week&search=ANR&date=2026-10-04");

    render(<ViewState />);

    expect(screen.getByText("week|ANR|2026-10-04")).toBeInTheDocument();
  });

  it("reads a malformed value as the default", () => {
    at("/trips?view=year&date=yesterday");

    render(<ViewState />);

    expect(screen.getByText("day||2026-10-09")).toBeInTheDocument();
  });

  it("writes nothing while mounting, not even to tidy the address", () => {
    at("/trips?view=year");

    render(
      <StrictMode>
        <ViewState />
      </StrictMode>,
    );

    expect(window.location.search).toBe("?view=year");
  });

  it("replaces the current entry on a change, and adds no history entry", () => {
    at("/trips");
    const entries = window.history.length;
    render(<ViewState />);

    act(() => setView("week"));
    act(() => setSearch("MSKU"));

    expect(window.location.search).toBe("?view=week&search=MSKU");
    expect(window.history.length).toBe(entries);
  });

  it("removes a parameter set back to its default", () => {
    at("/trips?view=week");
    render(<ViewState />);

    act(() => setView("day"));

    expect(window.location.search).toBe("");
  });

  it("keeps the entry's key, so its scroll position stays with it", () => {
    at("/trips");
    stampEntryKey("entry-1");
    render(<ViewState />);

    act(() => setView("month"));

    expect(readEntryKey()).toBe("entry-1");
  });

  it("leaves parameters it does not own alone", () => {
    at("/trips?other=1");
    render(<ViewState />);

    act(() => setView("week"));

    expect(new URLSearchParams(window.location.search).get("other")).toBe("1");
  });
});

describe("useResetOnChange", () => {
  let resets: number;

  function Paged({ query }: { query: object }) {
    useResetOnChange(query, () => {
      resets += 1;
    });

    return null;
  }

  beforeEach(() => {
    resets = 0;
  });

  it("does not reset on mount, even under StrictMode's double effects", () => {
    const query = { status: "OPEN" };

    render(
      <StrictMode>
        <Paged query={query} />
      </StrictMode>,
    );

    expect(resets).toBe(0);
  });

  it("resets when the value changes", () => {
    const { rerender } = render(<Paged query={{ status: "OPEN" }} />);

    rerender(<Paged query={{ status: "CLOSED" }} />);

    expect(resets).toBe(1);
  });

  it("does not reset for a re-render with the same value", () => {
    const query = { status: "OPEN" };
    const { rerender } = render(<Paged query={query} />);

    rerender(<Paged query={query} />);

    expect(resets).toBe(0);
  });
});
