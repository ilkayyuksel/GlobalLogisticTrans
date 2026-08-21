import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  VEHICLE,
  VEHICLE_COLOR,
  buildPage,
  buildTrip,
  renderRitten,
  respondWith,
} from "./ritten-test-support";
import { request } from "@/lib/api/client";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

jest.mock("@/lib/calendar/calendar-dates", () => ({
  ...jest.requireActual("@/lib/calendar/calendar-dates"),
  today: () => "2026-08-13",
}));

const requestMock = request as jest.MockedFunction<typeof request>;

/** The data row carrying a booking number, past the per-truck headings. */
function rowOf(table: HTMLElement, bookingNumber: string): HTMLElement {
  return within(table).getByText(bookingNumber).closest("tr") as HTMLElement;
}

const COLUMNS = [
  // The selection column's heading is for screen readers only.
  "Selecteer rit",
  "Groep",
  "Status",
  "Nummerplaat",
  "Datum",
  "Begin",
  "Eind",
  "Container",
  "Cntr type",
  "Booking",
  "Terminal",
  "Adres",
  "Custom",
  "Wachttijd",
  "PDF",
  "Acties",
];

/**
 * The Ritten table.
 *
 * Every cell here is a field the Trip response already carried. The tests that
 * matter most are the ones about absence: a missing value must read as missing,
 * never as a blank that could be mistaken for "none".
 */
describe("Ritten table", () => {
  beforeEach(() => {
    requestMock.mockReset();
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  async function showRow(...trips: ReturnType<typeof buildTrip>[]) {
    respondWith(requestMock, {
      trips: buildPage(trips.length > 0 ? trips : [buildTrip()]),
    });

    renderRitten();

    return (await screen.findByRole("table")) as HTMLTableElement;
  }

  describe("columns", () => {
    it("shows every column of the target structure, in order", async () => {
      const table = await showRow();

      const head = table.querySelector("thead") as HTMLElement;

      expect(
        within(head)
          .getAllByRole("columnheader")
          .map((header) => header.textContent),
      ).toEqual(COLUMNS);
    });

    it("fills each cell from the Trip the backend returned", async () => {
      const table = await showRow(
        buildTrip({ waitingTimeMinutes: 45, tripGroupId: null }),
      );
      const row = rowOf(table, "ANRDUB2602247");

      expect(within(row).getByText("1-ABC-123")).toBeInTheDocument();
      expect(within(row).getByText("13/08/2026")).toBeInTheDocument();
      expect(within(row).getByText("10:00")).toBeInTheDocument();
      expect(within(row).getByText("16:00")).toBeInTheDocument();
      expect(within(row).getByText("MSKU1234567")).toBeInTheDocument();
      expect(within(row).getByText("45PH")).toBeInTheDocument();
      expect(within(row).getByText("ANRDUB2602247")).toBeInTheDocument();
      expect(within(row).getByText("PSA Quay 869")).toBeInTheDocument();
      expect(within(row).getByText("Dourges, France")).toBeInTheDocument();
      expect(within(row).getByText("45 min")).toBeInTheDocument();
    });

    /** A blank cell would read as "nothing to see"; these are "not known". */
    it("marks the fields the Trip does not have", async () => {
      const table = await showRow(
        buildTrip({
          containerNumber: null,
          terminal: null,
          startTime: null,
          endTime: null,
          waitingTimeMinutes: null,
        }),
      );
      const row = rowOf(table, "ANRDUB2602247");

      expect(within(row).getAllByText("—").length).toBeGreaterThanOrEqual(5);
    });

  });

  /**
   * The Custom column.
   *
   * The names travel with the Trip in the list response, so the column can say
   * what a Trip is carrying without a request per row. It stays the way into
   * the manager either way.
   */
  describe("the Custom column", () => {
    function withProperties(
      ...names: { name: string; isActive?: boolean }[]
    ) {
      return buildTrip({
        customProperties: names.map((property, index) => ({
          id: `custom-${index}`,
          name: property.name,
          isActive: property.isActive ?? true,
        })),
      });
    }

    it("names what the Trip is carrying", async () => {
      const table = await showRow(
        withProperties({ name: "TAR" }, { name: "Flat" }),
      );

      expect(within(table).getByText("TAR")).toBeInTheDocument();
      expect(within(table).getByText("Flat")).toBeInTheDocument();
    });

    /** A table cell has room for a couple of names, not for six. */
    it("counts the ones that do not fit", async () => {
      const table = await showRow(
        withProperties(
          { name: "TAR" },
          { name: "Flat" },
          { name: "Tol" },
          { name: "Wachttijd" },
        ),
      );

      expect(within(table).getByText("+2")).toBeInTheDocument();
      expect(within(table).queryByText("Tol")).not.toBeInTheDocument();
    });

    /** The full set is there for anyone hovering, and for the dialog. */
    it("carries every name in its title", async () => {
      const table = await showRow(
        withProperties({ name: "TAR" }, { name: "Flat" }, { name: "Tol" }),
      );

      expect(
        within(table).getByRole("button", {
          name: "Custom waarden beheren ANRDUB2602247",
        }),
      ).toHaveAttribute("title", "TAR, Flat, Tol");
    });

    /** The property was deactivated later; the assignment still stands. */
    it("marks a property that is no longer active", async () => {
      const table = await showRow(
        withProperties({ name: "Tol", isActive: false }),
      );

      expect(within(table).getByText("Tol")).toHaveClass("line-through");
    });

    it("invites the manager when the Trip carries none", async () => {
      const table = await showRow();

      expect(within(table).getByText("Custom waarden beheren")).toBeInTheDocument();
    });

    it("opens the manager for that Trip", async () => {
      const table = await showRow(withProperties({ name: "TAR" }));

      await userEvent.click(
        within(table).getByRole("button", {
          name: "Custom waarden beheren ANRDUB2602247",
        }),
      );

      expect(
        await screen.findByRole("dialog", { name: /Custom waarden/ }),
      ).toBeInTheDocument();
    });
  });

  describe("the vehicle and its driver", () => {
    it("shows the plate and the vehicle's own colour", async () => {
      const table = await showRow();
      const row = rowOf(table, "ANRDUB2602247");

      expect(within(table).getAllByText("1-ABC-123").length).toBeGreaterThan(0);
      expect(row.outerHTML).toContain(VEHICLE_COLOR);
    });

    it("says so when no vehicle is assigned", async () => {
      const table = await showRow(
        buildTrip({ vehicle: null, vehicleId: null }),
      );

      expect(within(table).getByText("Geen voertuig")).toBeInTheDocument();
    });

    /** The backend resolved this; the frontend never works out a driver. */
    it("shows the effective driver the backend supplied", async () => {
      const table = await showRow();

      expect(within(table).getByText("Piet Janssens")).toBeInTheDocument();
      expect(within(table).queryByText("Override")).not.toBeInTheDocument();
    });

    it("marks a driver who has since been deactivated", async () => {
      const table = await showRow(
        buildTrip({
          effectiveDriver: {
            id: "driver-2",
            name: "Ayşe Yılmaz",
            isActive: false,
            source: "VEHICLE_ASSIGNMENT",
          },
          latestUpdate: null,
          costConfirmation: null,
        }),
      );

      expect(within(table).getByText("Ayşe Yılmaz")).toBeInTheDocument();
      expect(within(table).getByText("(inactief)")).toBeInTheDocument();
    });

    it("says so when no driver is resolved", async () => {
      const table = await showRow(buildTrip({ effectiveDriver: null }));

      expect(within(table).getByText("Geen chauffeur")).toBeInTheDocument();
    });

    it("marks a vehicle that has since been deactivated", async () => {
      const table = await showRow(
        buildTrip({ vehicle: { ...VEHICLE, isActive: false } }),
      );

      expect(within(table).getByText("(inactief)")).toBeInTheDocument();
    });
  });

  describe("status", () => {
    it.each([
      ["OPEN", "Open"],
      ["CLOSED", "Afgewerkt"],
      ["CANCELLED", "Geannuleerd"],
      ["DELETED", "Verwijderd"],
    ] as const)("shows %s as %s", async (status, label) => {
      const table = await showRow(buildTrip({ status }));

      expect(within(table).getByText(label)).toBeInTheDocument();
    });

    /**
     * ── THE COMPLETED-TRIP MARK ───────────────────────────────────────────
     * A finished transport is washed in the warning token so a planner can see
     * at a glance which rows are done. It marks the ROW, which is what keeps it
     * distinguishable from a field-level highlight on a single value, and it is
     * a token rather than a colour so both themes get it for free.
     * ──────────────────────────────────────────────────────────────────────
     */
    it("marks a completed Trip's row", async () => {
      const table = await showRow(buildTrip({ status: "CLOSED" }));

      expect(rowOf(table, "ANRDUB2602247").className).toContain("bg-warning/10");
    });

    it.each(["OPEN", "CANCELLED"] as const)(
      "leaves a %s Trip's row unmarked",
      async (status) => {
        const table = await showRow(buildTrip({ status }));

        expect(rowOf(table, "ANRDUB2602247").className).not.toContain(
          "bg-warning",
        );
      },
    );

    it("uses no literal colour for the mark", async () => {
      const table = await showRow(buildTrip({ status: "CLOSED" }));
      // The vehicle's own colour is data; the completed mark must be a token.
      const markup = rowOf(table, "ANRDUB2602247")
        .outerHTML.split(VEHICLE_COLOR)
        .join("");

      expect(markup).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    });
  });

  describe("navigation", () => {
    it("links the booking number to the Trip detail page", async () => {
      const table = await showRow();

      expect(
        within(table).getByRole("link", { name: "ANRDUB2602247" }),
      ).toHaveAttribute("href", "/trips/trip-1");
    });

    /**
     * The booking number is already the way into a Trip. A second link beside
     * the action menu was the same navigation twice, in a row that has run out
     * of horizontal room.
     */
    it("does not repeat that link beside the action menu", async () => {
      const table = await showRow();

      expect(
        within(table).queryByRole("link", { name: "Openen" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("groups", () => {
    const GROUP_ID = "97777777-7777-4777-8777-777777777777";

    it("marks an ungrouped Trip as such", async () => {
      const table = await showRow();

      expect(within(table).getByText("Geen groep")).toBeInTheDocument();
    });

    it("labels a Combination leg with its group", async () => {
      const table = await showRow(buildTrip({ tripGroupId: GROUP_ID }));

      expect(within(table).getByText("G-9777")).toBeInTheDocument();
    });

    it("gives both legs of one Combination the same marker", async () => {
      const table = await showRow(
        buildTrip({ id: "a", bookingNumber: "LEG-A", tripGroupId: GROUP_ID }),
        buildTrip({ id: "b", bookingNumber: "LEG-B", tripGroupId: GROUP_ID }),
      );

      expect(within(table).getAllByText("G-9777")).toHaveLength(2);
    });

    /**
     * Fetched by group id, not gathered from the rows on screen: the other leg
     * may be planned for another day entirely.
     */
    it("opens a dialog listing every leg, fetched from the backend", async () => {
      respondWith(requestMock, {
        trips: buildPage([buildTrip({ tripGroupId: GROUP_ID })]),
        groupMembers: [
          buildTrip({ id: "a", bookingNumber: "DUBANR2598395", tripGroupId: GROUP_ID }),
          buildTrip({
            id: "b",
            bookingNumber: "ANRBEL2603249",
            tripGroupId: GROUP_ID,
            planningDate: "2026-08-20",
          }),
        ],
      });

      renderRitten();
      await userEvent.click(await screen.findByText("G-9777"));

      const dialog = await screen.findByRole("dialog");

      expect(
        within(dialog).getByRole("link", { name: "DUBANR2598395" }),
      ).toHaveAttribute("href", "/trips/a");
      expect(
        within(dialog).getByRole("link", { name: "ANRBEL2603249" }),
      ).toHaveAttribute("href", "/trips/b");
      // The leg planned for another day is present, which is the point.
      expect(within(dialog).getByText(/20\/08\/2026/)).toBeInTheDocument();
    });

    it("asks for the group by id", async () => {
      respondWith(requestMock, {
        trips: buildPage([buildTrip({ tripGroupId: GROUP_ID })]),
        groupMembers: [buildTrip({ tripGroupId: GROUP_ID })],
      });

      renderRitten();
      await userEvent.click(await screen.findByText("G-9777"));
      await screen.findByRole("dialog");

      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/trips",
        expect.objectContaining({
          query: expect.objectContaining({ tripGroupId: GROUP_ID }),
        }),
      );
    });

    it("closes again", async () => {
      respondWith(requestMock, {
        trips: buildPage([buildTrip({ tripGroupId: GROUP_ID })]),
        groupMembers: [buildTrip({ tripGroupId: GROUP_ID })],
      });

      renderRitten();
      await userEvent.click(await screen.findByText("G-9777"));
      await userEvent.click(
        await within(await screen.findByRole("dialog")).findByRole("button", {
          name: "Sluiten",
        }),
      );

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
    });
  });

  describe("presentation", () => {
    it("translates the columns into Turkish", async () => {
      window.localStorage.setItem("tms.language", "tr");

      const table = await showRow();

      const head = table.querySelector("thead") as HTMLElement;

      expect(
        within(head)
          .getAllByRole("columnheader")
          .map((header) => header.textContent),
      ).toEqual([
        "Seferi seç",
        "Grup",
        "Durum",
        "Plaka",
        "Tarih",
        "Başlangıç",
        "Bitiş",
        "Konteyner",
        "Kntr tipi",
        "Booking",
        "Terminal",
        "Adres",
        "Özel",
        "Bekleme",
        "PDF",
        "İşlemler",
      ]);
      expect(within(table).getByText("Açık")).toBeInTheDocument();
    });

    /**
     * Colours come from the design tokens, so both themes are covered by the
     * same markup. The one literal colour allowed is the vehicle's own, which
     * is data the backend supplied.
     */
    it.each(["light", "dark"])("uses design tokens in %s mode", async (theme) => {
      // The theme is a class on <html>, which the pre-paint script sets in the
      // browser. Applying it directly here is what a dark-mode render is.
      document.documentElement.classList.toggle("dark", theme === "dark");

      const table = await showRow();
      const withoutVehicleColor = table.innerHTML.split(VEHICLE_COLOR).join("");

      expect(withoutVehicleColor).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      // The same markup serves both themes; only the token values differ.
      expect(within(table).getByText("Open")).toBeInTheDocument();
      expect(within(table).getAllByText("1-ABC-123").length).toBeGreaterThan(0);
    });
  });
});
