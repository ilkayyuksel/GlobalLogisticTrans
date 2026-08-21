import { screen, within } from "@testing-library/react";

import {
  buildPage,
  buildTrip,
  renderRitten,
  respondWith,
} from "./ritten-test-support";
import { request } from "@/lib/api/client";
import type { LatestTripUpdate } from "@/lib/api/types";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

const requestMock = request as jest.MockedFunction<typeof request>;

/**
 * The fields the LATEST update document changed.
 *
 * ── WHAT THE MARK MEANS, AND WHAT IT MUST NOT ───────────────────────────────
 * "The most recent UPDATE moved this field." Not "this was edited at some
 * point": when a newer update arrives, the previous update's fields go back to
 * normal. A mark that accumulated would, after a few weeks, say that every
 * field had just changed — which is the same as saying nothing.
 *
 * Which fields those are is the BACKEND's answer, carried on the Trip. Nothing
 * on this side compares values, and these tests assert exactly that by feeding
 * a change set that does NOT match the values on screen.
 * ────────────────────────────────────────────────────────────────────────────
 */

const MARK = "bg-warning/15";

function latestUpdate(changedFields: string[]): LatestTripUpdate {
  return {
    occurredAt: "2026-08-20T09:00:00.000Z",
    changedFields,
    pdfDocumentId: "pdf-update-1",
  };
}

async function showTrip(overrides = {}) {
  respondWith(requestMock, {
    trips: buildPage([buildTrip(overrides)]),
  });
  renderRitten();

  const row = (await screen.findByText("ANRDUB2602247")).closest(
    "tr",
  ) as HTMLElement;

  return row;
}

/** The marked element wrapping a value, if there is one. */
function markAround(row: HTMLElement, text: string | RegExp): Element | null {
  const value = within(row).getByText(text);

  return value.closest(`.${CSS.escape(MARK)}`);
}

beforeEach(() => {
  requestMock.mockReset();
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});

describe("the fields the latest update changed", () => {
  it("marks a field the latest update moved", async () => {
    const row = await showTrip({
      latestUpdate: latestUpdate(["containerNumber"]),
    });

    expect(markAround(row, "MSKU1234567")).not.toBeNull();
  });

  it("leaves the other fields unmarked", async () => {
    const row = await showTrip({
      latestUpdate: latestUpdate(["containerNumber"]),
    });

    expect(markAround(row, "PSA Quay 869")).toBeNull();
    expect(markAround(row, "45PH")).toBeNull();
  });

  it("marks several fields when the update moved several", async () => {
    const row = await showTrip({
      latestUpdate: latestUpdate(["terminal", "destinationCity"]),
    });

    expect(markAround(row, "PSA Quay 869")).not.toBeNull();
    expect(markAround(row, /Dourges/)).not.toBeNull();
  });

  /** An update that moved nothing marks nothing — and is still an update. */
  it("marks nothing when the latest update changed nothing", async () => {
    const row = await showTrip({ latestUpdate: latestUpdate([]) });

    expect(row.innerHTML).not.toContain(MARK);
  });

  it("marks nothing when no update has ever arrived", async () => {
    const row = await showTrip({ latestUpdate: null });

    expect(row.innerHTML).not.toContain(MARK);
  });

  it("marks the times the latest update moved", async () => {
    const row = await showTrip({
      latestUpdate: latestUpdate(["startTime", "endTime"]),
    });

    expect(markAround(row, "10:00")).not.toBeNull();
    expect(markAround(row, "16:00")).not.toBeNull();
  });

  it("marks an editable cell without disturbing its editor", async () => {
    const row = await showTrip({
      latestUpdate: latestUpdate(["containerNumber"]),
    });

    expect(markAround(row, "MSKU1234567")).not.toBeNull();
    // Still the same inline editor it was before the mark existed.
    expect(
      within(row).getByRole("button", { name: "Containernummer" }),
    ).toBeInTheDocument();
  });
});

describe("the derived Bijgewerkt marker", () => {
  it("appears beside the status of an updated OPEN Trip", async () => {
    const row = await showTrip({
      status: "OPEN",
      latestUpdate: latestUpdate(["containerNumber"]),
    });

    expect(within(row).getByText("Open")).toBeInTheDocument();
    expect(within(row).getByText("Bijgewerkt")).toBeInTheDocument();
  });

  /** It is not a status: the lifecycle badge is still the lifecycle. */
  it("does not replace the lifecycle status", async () => {
    const row = await showTrip({
      status: "OPEN",
      latestUpdate: latestUpdate(["containerNumber"]),
    });

    expect(within(row).queryByText("Geannuleerd")).toBeNull();
    expect(within(row).getByText("Open")).toBeInTheDocument();
  });

  it("is absent from an OPEN Trip that no update has touched", async () => {
    const row = await showTrip({ status: "OPEN", latestUpdate: null });

    expect(within(row).queryByText("Bijgewerkt")).toBeNull();
  });

  /**
   * On a finished or cancelled Trip the lifecycle state is what matters; a
   * second marker beside it would compete with it for no gain.
   */
  it.each([
    ["CLOSED", "Afgewerkt"],
    ["CANCELLED", "Geannuleerd"],
  ] as const)("is absent from a %s Trip", async (status, label) => {
    const row = await showTrip({
      status,
      latestUpdate: latestUpdate(["containerNumber"]),
    });

    expect(within(row).getByText(label)).toBeInTheDocument();
    expect(within(row).queryByText("Bijgewerkt")).toBeNull();
  });
});

describe("telling the two yellows apart", () => {
  /**
   * A completed Trip washes the whole ROW; a changed field marks the VALUE.
   * They mean different things and must never be mistaken for one another.
   */
  it("uses a different treatment from the completed row", async () => {
    const row = await showTrip({
      status: "CLOSED",
      latestUpdate: latestUpdate(["containerNumber"]),
    });

    expect(row.className).toContain("bg-warning/10");
    expect(row.className).not.toContain(MARK);
    expect(markAround(row, "MSKU1234567")).not.toBeNull();
  });

  it("marks a field on an open Trip without washing the row", async () => {
    const row = await showTrip({
      status: "OPEN",
      latestUpdate: latestUpdate(["containerNumber"]),
    });

    expect(row.className).not.toContain("bg-warning/10");
    expect(markAround(row, "MSKU1234567")).not.toBeNull();
  });
});

describe("presentation", () => {
  it("translates the marker", async () => {
    window.localStorage.setItem("tms.language", "tr");

    const row = await showTrip({
      status: "OPEN",
      latestUpdate: latestUpdate(["containerNumber"]),
    });

    expect(within(row).getByText("Güncellendi")).toBeInTheDocument();
  });

  it.each(["light", "dark"])("uses design tokens in %s mode", async (theme) => {
    document.documentElement.classList.toggle("dark", theme === "dark");

    const row = await showTrip({
      latestUpdate: latestUpdate(["containerNumber"]),
    });
    const mark = markAround(row, "MSKU1234567") as Element;

    // A token, so both themes get it from the same class.
    expect(mark.className).toContain("bg-warning/15");
    expect(mark.outerHTML).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});

/**
 * ── THE SEQUENCE THE REAL DOCUMENTS PRODUCE ─────────────────────────────────
 * The backend workflow spec drives `UPDATE/transportorder1368223.pdf` three
 * times and produces exactly these change sets: containerNumber, then terminal,
 * then nothing. This is what the operator sees for that sequence — each step
 * marking only what that step moved.
 * ────────────────────────────────────────────────────────────────────────────
 */
describe("the marks across a real sequence of updates", () => {
  it("marks the container after the first update", async () => {
    const row = await showTrip({
      latestUpdate: latestUpdate(["containerNumber"]),
    });

    expect(markAround(row, "MSKU1234567")).not.toBeNull();
    expect(markAround(row, "PSA Quay 869")).toBeNull();
  });

  it("moves the mark to the terminal after the second", async () => {
    const row = await showTrip({ latestUpdate: latestUpdate(["terminal"]) });

    expect(markAround(row, "PSA Quay 869")).not.toBeNull();
    // The first update's field is no longer what changed.
    expect(markAround(row, "MSKU1234567")).toBeNull();
  });

  it("marks nothing after a third update that repeats the second", async () => {
    const row = await showTrip({ latestUpdate: latestUpdate([]) });

    expect(row.innerHTML).not.toContain(MARK);
    // The Trip is still an updated Trip, and still says so.
    expect(within(row).getByText("Bijgewerkt")).toBeInTheDocument();
  });

  /**
   * After a cancellation the refused update must not become the latest one:
   * the backend keeps reporting the last APPLIED update, so the marks stay
   * where they were and the lifecycle badge carries the news.
   */
  it("keeps the last applied update's marks after a cancellation", async () => {
    const row = await showTrip({
      status: "CANCELLED",
      latestUpdate: latestUpdate(["terminal"]),
    });

    expect(within(row).getByText("Geannuleerd")).toBeInTheDocument();
    expect(markAround(row, "PSA Quay 869")).not.toBeNull();
  });
});
