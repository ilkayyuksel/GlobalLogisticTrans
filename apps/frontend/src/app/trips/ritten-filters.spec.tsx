import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  buildPage,
  buildTrip,
  lastListCall,
  listCalls,
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

/** A real UUID, because the backend validates the filter as one. */
const CUSTOM_PROPERTY_ID = "8f6b1f7e-2b1e-4d5a-9c3f-7a1e2b3c4d5e";

/**
 * Filters, search and counters.
 *
 * Every assertion here is about the REQUEST. A filter that narrowed the rows on
 * screen without narrowing the query would look like it worked while ignoring
 * everything past the first page, so what matters is that the backend was asked.
 */
describe("Ritten filters", () => {
  beforeEach(() => {
    requestMock.mockReset();
    window.localStorage.clear();
  });

  async function showList(
    extra: Parameters<typeof respondWith>[1] = {},
  ): Promise<void> {
    respondWith(requestMock, {
      trips: buildPage([buildTrip()]),
      open: 7,
      closed: 30,
      total: 42,
      ...extra,
    });

    renderRitten();
    await screen.findByText("ANRDUB2602247");
  }

  describe("search", () => {
    it("sends the term to the backend", async () => {
      await showList();

      await userEvent.type(screen.getByLabelText("Zoeken"), "rotterdam");

      await waitFor(() => {
        expect(lastListCall(requestMock)).toMatchObject({
          search: "rotterdam",
        });
      });
    });

    /** One request for a typed word, not one per keystroke. */
    it("waits for the typing to stop", async () => {
      await showList();

      const before = listCalls(requestMock).length;
      await userEvent.type(screen.getByLabelText("Zoeken"), "rotterdam");

      await waitFor(() => {
        expect(lastListCall(requestMock).search).toBe("rotterdam");
      });

      expect(listCalls(requestMock).length - before).toBeLessThan(
        "rotterdam".length,
      );
    });

    it("keeps the selected period while searching", async () => {
      await showList();

      await userEvent.type(screen.getByLabelText("Zoeken"), "psa");

      await waitFor(() => {
        expect(lastListCall(requestMock)).toMatchObject({
          search: "psa",
          planningDate: "2026-08-13",
        });
      });
    });
  });

  describe("status", () => {
    it("filters on Open", async () => {
      await showList();

      await userEvent.click(
        within(screen.getByRole("radiogroup", { name: "Status" })).getByRole(
          "radio",
          { name: "Open" },
        ),
      );

      await waitFor(() => {
        expect(lastListCall(requestMock)).toMatchObject({ status: "OPEN" });
      });
    });

    it("clears the filter again with Alle", async () => {
      await showList();
      const group = screen.getByRole("radiogroup", { name: "Status" });

      await userEvent.click(within(group).getByRole("radio", { name: "Open" }));
      await waitFor(() => {
        expect(lastListCall(requestMock).status).toBe("OPEN");
      });

      await userEvent.click(within(group).getByRole("radio", { name: "Alle" }));

      await waitFor(() => {
        expect(lastListCall(requestMock).status).toBeUndefined();
      });
    });
  });

  describe("vehicle", () => {
    it("offers the active vehicles and filters by the one chosen", async () => {
      await showList();

      await userEvent.selectOptions(
        screen.getByLabelText("Nummerplaat"),
        "vehicle-1",
      );

      await waitFor(() => {
        expect(lastListCall(requestMock)).toMatchObject({
          vehicleId: "vehicle-1",
        });
      });
    });

    /** The operator picks a plate; the API matches on the vehicle's id. */
    it("shows plates, not identifiers", async () => {
      await showList();

      expect(
        within(screen.getByLabelText("Nummerplaat")).getByRole("option", {
          name: "1-ABC-123",
        }),
      ).toBeInTheDocument();
    });
  });

  /**
   * The terminal filter.
   *
   * A picker rather than a text box: the backend matches the terminal exactly,
   * and an operator cannot be expected to reproduce `PSA Quay 869` character
   * for character. The options are the terminals the Trips themselves carry —
   * there is no terminal master data anywhere in this system.
   */
  describe("terminal", () => {
    it("offers the terminals the backend reported", async () => {
      await showList();

      const picker = screen.getByLabelText("Terminal");

      expect(
        within(picker).getByRole("option", { name: "PSA Quay 869" }),
      ).toBeInTheDocument();
      expect(
        within(picker).getByRole("option", { name: "Alle terminals" }),
      ).toBeInTheDocument();
    });

    it("filters on the terminal that was chosen", async () => {
      await showList();

      await userEvent.selectOptions(
        screen.getByLabelText("Terminal"),
        "PSA Quay 869",
      );

      await waitFor(() => {
        expect(lastListCall(requestMock)).toMatchObject({
          terminal: "PSA Quay 869",
        });
      });
    });

    it("asks the backend for its options once", async () => {
      await showList();

      await waitFor(() => {
        expect(
          requestMock.mock.calls.filter(
            ([path]) => path === "/api/v1/trips/terminals",
          ),
        ).toHaveLength(1);
      });
    });
  });

  /** Filtering by Custom Property is `?customPropertyId=`, added for this. */
  describe("custom values", () => {
    it("offers the active Custom Properties", async () => {
      await showList({
        availableCustomProperties: [
          { id: CUSTOM_PROPERTY_ID, name: "TAR", isActive: true },
        ],
      });

      expect(
        within(screen.getByLabelText("Custom waarde")).getByRole("option", {
          name: "TAR",
        }),
      ).toBeInTheDocument();
    });

    it("filters on the property that was chosen", async () => {
      await showList({
        availableCustomProperties: [
          { id: CUSTOM_PROPERTY_ID, name: "TAR", isActive: true },
        ],
      });

      await userEvent.selectOptions(
        screen.getByLabelText("Custom waarde"),
        CUSTOM_PROPERTY_ID,
      );

      await waitFor(() => {
        expect(lastListCall(requestMock)).toMatchObject({
          customPropertyId: CUSTOM_PROPERTY_ID,
        });
      });
    });
  });

  describe("clearing", () => {
    it("appears only once something is filtered, and resets everything", async () => {
      await showList();

      expect(
        screen.queryByRole("button", { name: "Filters wissen" }),
      ).not.toBeInTheDocument();

      await userEvent.type(screen.getByLabelText("Zoeken"), "psa");
      await userEvent.click(
        await screen.findByRole("button", { name: "Filters wissen" }),
      );

      await waitFor(() => {
        expect(lastListCall(requestMock).search).toBeUndefined();
      });
    });
  });

  describe("counters", () => {
    it("shows the backend's counts for the period", async () => {
      await showList();

      expect(
        await within(
          screen.getByRole("button", { name: /Open ritten/ }),
        ).findByText("7"),
      ).toBeInTheDocument();
      expect(
        within(screen.getByRole("button", { name: /Afgewerkt/ })).getByText("30"),
      ).toBeInTheDocument();
      expect(
        within(screen.getByRole("button", { name: /Totaal/ })).getByText("42"),
      ).toBeInTheDocument();
    });

    /** Counted by the database, never by tallying the rows on screen. */
    it("asks the backend to count instead of counting rows", async () => {
      await showList();

      const counting = requestMock.mock.calls.filter(
        ([path, options]) =>
          path === "/api/v1/trips" && options?.query?.pageSize === 1,
      );

      expect(counting).toHaveLength(3);
      expect(
        counting.every(
          ([, options]) => options?.query?.planningDate === "2026-08-13",
        ),
      ).toBe(true);
    });

    it("keeps counting every status while one of them is filtered", async () => {
      await showList();

      await userEvent.click(screen.getByRole("button", { name: /Open ritten/ }));

      await waitFor(() => {
        expect(lastListCall(requestMock).status).toBe("OPEN");
      });

      // The counts still describe the whole period, so Afgewerkt is not zero.
      expect(
        within(screen.getByRole("button", { name: /Afgewerkt/ })).getByText("30"),
      ).toBeInTheDocument();
    });

    it("doubles as the status filter", async () => {
      await showList();

      await userEvent.click(screen.getByRole("button", { name: /Afgewerkt/ }));

      await waitFor(() => {
        expect(lastListCall(requestMock).status).toBe("CLOSED");
      });
      expect(
        within(screen.getByRole("radiogroup", { name: "Status" })).getByRole(
          "radio",
          { name: "Afgewerkt" },
        ),
      ).toHaveAttribute("aria-checked", "true");
    });
  });

  describe("in Turkish", () => {
    it("translates the filters", async () => {
      window.localStorage.setItem("tms.language", "tr");
      await showList();

      expect(screen.getByLabelText("Ara")).toBeInTheDocument();
      expect(screen.getByLabelText("Plaka")).toBeInTheDocument();
      expect(screen.getByLabelText("Özel değer")).toBeInTheDocument();
      expect(screen.getByLabelText("Terminal")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Açık seferler/ }),
      ).toBeInTheDocument();
    });
  });
});
