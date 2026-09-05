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

/**
 * LOSRIT, and the destination of a Trip entered by hand.
 *
 * ── LOSRIT IS NOT A STATUS ──────────────────────────────────────────────────
 * It is the operator's classification of what kind of transport this is, and it
 * travels beside the lifecycle rather than inside it: a LOSRIT is OPEN, CLOSED
 * or CANCELLED like any other Trip and is offered exactly the same actions.
 * Making it a TripStatus would have made those combinations unrepresentable.
 *
 * ── THE DESTINATION OF A MANUAL TRIP ────────────────────────────────────────
 * It used to be read-only everywhere, described as parser-controlled — which is
 * only true where a parser exists. A Trip entered by hand has no document, so a
 * city typed wrongly at creation could never be corrected afterwards. It can
 * now, and only there: an imported Trip still belongs to its document, which a
 * later UPDATE re-reads.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** No PDF: nothing but the operator can say where this Trip is going. */
const MANUAL = { pdfDocumentId: null } as const;

function mutationBody(path: string): Record<string, unknown> | undefined {
  const call = mutationCalls(requestMock).find(([called]) =>
    String(called).startsWith(path),
  );

  return (call?.[1] as { body?: Record<string, unknown> } | undefined)?.body;
}

async function showTrip(overrides = {}): Promise<void> {
  respondWith(requestMock, { trips: buildPage([buildTrip(overrides)]) });
  renderRitten();
  await screen.findByRole("table");
}

async function openCreateForm(): Promise<HTMLElement> {
  respondWith(requestMock, { trips: buildPage([]) });
  renderRitten();

  await userEvent.click(
    await screen.findByRole("button", { name: "+ Nieuwe rit" }),
  );

  return screen.getByRole("dialog");
}

describe("LOSRIT", () => {
  beforeEach(() => {
    requestMock.mockReset();
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  describe("marking a new Trip as one", () => {
    it("offers the choice when creating a Trip by hand", async () => {
      const dialog = await openCreateForm();

      expect(within(dialog).getByLabelText("Losrit")).not.toBeChecked();
    });

    it("says what it means", async () => {
      const dialog = await openCreateForm();

      expect(
        within(dialog).getByText(/De status blijft gewoon Open/),
      ).toBeInTheDocument();
    });

    it("sends it when ticked", async () => {
      const dialog = await openCreateForm();

      await userEvent.click(within(dialog).getByLabelText("Losrit"));
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Rit aanmaken" }),
      );

      await waitFor(() => {
        expect(mutationBody("/api/v1/trips")?.isLooseTrip).toBe(true);
      });
    });

    it("sends false when it is left alone", async () => {
      const dialog = await openCreateForm();

      await userEvent.click(
        within(dialog).getByRole("button", { name: "Rit aanmaken" }),
      );

      await waitFor(() => {
        expect(mutationBody("/api/v1/trips")?.isLooseTrip).toBe(false);
      });
    });

    /**
     * Ticking it classifies the Trip and does nothing else. The status is not
     * sent at all — every Trip starts OPEN through the backend's own default —
     * and the planning is whatever was typed.
     */
    it("changes nothing else about the Trip", async () => {
      const dialog = await openCreateForm();

      await userEvent.click(within(dialog).getByLabelText("Losrit"));
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Rit aanmaken" }),
      );

      await waitFor(() => {
        expect(mutationBody("/api/v1/trips")).toBeDefined();
      });

      const body = mutationBody("/api/v1/trips") as Record<string, unknown>;

      expect(body).not.toHaveProperty("status");
      expect(body.planningDate).toBeNull();
      expect(body.vehicleId).toBeNull();
    });
  });

  describe("the badge", () => {
    it("marks a LOSRIT in the list", async () => {
      await showTrip({ isLooseTrip: true });

      expect(
        within(screen.getByRole("table")).getByText("LOSRIT"),
      ).toBeInTheDocument();
    });

    it("says nothing on an ordinary Trip", async () => {
      await showTrip({ isLooseTrip: false });

      expect(screen.queryByText("LOSRIT")).toBeNull();
    });

    /** Beside the lifecycle badge, never in place of it. */
    it.each(["OPEN", "CLOSED", "CANCELLED"] as const)(
      "shows both the LOSRIT marker and the %s status",
      async (status) => {
        await showTrip({ status, isLooseTrip: true });

        const table = within(screen.getByRole("table"));
        const label = { OPEN: "Open", CLOSED: "Afgewerkt", CANCELLED: "Geannuleerd" }[
          status
        ];

        expect(table.getByText("LOSRIT")).toBeInTheDocument();
        expect(table.getByText(label)).toBeInTheDocument();
      },
    );
  });

  describe("the destination of a Trip created by hand", () => {
    it("can be opened for editing", async () => {
      await showTrip(MANUAL);

      await userEvent.click(
        screen.getByRole("button", { name: "Bestemming (stad, land)" }),
      );

      expect(
        screen.getByLabelText("Bestemming (stad, land)"),
      ).toHaveValue("Dourges, France");
    });

    it("saves the new city and country", async () => {
      await showTrip(MANUAL);

      await userEvent.click(
        screen.getByRole("button", { name: "Bestemming (stad, land)" }),
      );
      await userEvent.clear(screen.getByLabelText("Bestemming (stad, land)"));
      await userEvent.type(
        screen.getByLabelText("Bestemming (stad, land)"),
        "Venlo, Netherlands",
      );
      await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

      await waitFor(() => {
        expect(mutationBody("/api/v1/trips/trip-1")).toEqual({
          destinationCity: "Venlo",
          destinationCountry: "Netherlands",
        });
      });
    });

    /** It updates the SAME Trip — one PATCH, no second Trip anywhere. */
    it("updates the same Trip rather than creating another", async () => {
      await showTrip(MANUAL);

      await userEvent.click(
        screen.getByRole("button", { name: "Bestemming (stad, land)" }),
      );
      await userEvent.clear(screen.getByLabelText("Bestemming (stad, land)"));
      await userEvent.type(
        screen.getByLabelText("Bestemming (stad, land)"),
        "Venlo",
      );
      await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

      await waitFor(() => {
        expect(mutationCalls(requestMock)).toHaveLength(1);
      });

      const [path, options] = mutationCalls(requestMock)[0] as [
        string,
        { method?: string },
      ];

      expect(path).toBe("/api/v1/trips/trip-1");
      expect(options.method).toBe("PATCH");
    });

    /** Booking and container are the Trip's IDENTITY; a move never touches them. */
    it("sends nothing but the destination", async () => {
      await showTrip(MANUAL);

      await userEvent.click(
        screen.getByRole("button", { name: "Bestemming (stad, land)" }),
      );
      await userEvent.clear(screen.getByLabelText("Bestemming (stad, land)"));
      await userEvent.type(
        screen.getByLabelText("Bestemming (stad, land)"),
        "Venlo, Netherlands",
      );
      await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

      await waitFor(() => {
        expect(mutationBody("/api/v1/trips/trip-1")).toBeDefined();
      });

      const body = mutationBody("/api/v1/trips/trip-1") as Record<string, unknown>;

      expect(body).not.toHaveProperty("bookingNumber");
      expect(body).not.toHaveProperty("containerNumber");
      expect(body).not.toHaveProperty("planningDate");
    });

    /**
     * A city may contain a comma — "Saint Laurent Blangy, Pas-de-Calais,
     * France" is one place and one country — so only the FIRST comma separates
     * the two fields.
     */
    it("splits on the first comma only", async () => {
      await showTrip(MANUAL);

      await userEvent.click(
        screen.getByRole("button", { name: "Bestemming (stad, land)" }),
      );
      await userEvent.clear(screen.getByLabelText("Bestemming (stad, land)"));
      await userEvent.type(
        screen.getByLabelText("Bestemming (stad, land)"),
        "Saint Laurent Blangy, Pas-de-Calais, France",
      );
      await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

      await waitFor(() => {
        expect(mutationBody("/api/v1/trips/trip-1")).toEqual({
          destinationCity: "Saint Laurent Blangy",
          destinationCountry: "Pas-de-Calais, France",
        });
      });
    });

    it("clears the country when only a city is typed", async () => {
      await showTrip(MANUAL);

      await userEvent.click(
        screen.getByRole("button", { name: "Bestemming (stad, land)" }),
      );
      await userEvent.clear(screen.getByLabelText("Bestemming (stad, land)"));
      await userEvent.type(
        screen.getByLabelText("Bestemming (stad, land)"),
        "Venlo",
      );
      await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

      await waitFor(() => {
        expect(mutationBody("/api/v1/trips/trip-1")).toEqual({
          destinationCity: "Venlo",
          destinationCountry: null,
        });
      });
    });

    /** What the backend stored, refetched — never what the cell typed. */
    it("shows the refetched value afterwards", async () => {
      respondWith(requestMock, {
        trips: buildPage([buildTrip({ ...MANUAL, destinationCity: "Venlo" })]),
      });
      renderRitten();
      await screen.findByRole("table");

      expect(screen.getByText("Venlo, France")).toBeInTheDocument();
    });

    it("keeps the cell open and reports a refusal", async () => {
      await showTrip(MANUAL);

      await userEvent.click(
        screen.getByRole("button", { name: "Bestemming (stad, land)" }),
      );
      requestMock.mockRejectedValueOnce(
        new ApiError("CONFLICT", "Trip was imported from a PDF document.", 409),
      );
      await userEvent.click(screen.getByRole("button", { name: "Opslaan" }));

      // Twice: in the cell, which stays open, and in the page's feedback line.
      expect(
        await screen.findAllByText(/Trip was imported from a PDF document/),
      ).not.toHaveLength(0);
      expect(
        screen.getByLabelText("Bestemming (stad, land)"),
      ).toBeInTheDocument();
    });

    /** A LOSRIT is created by hand, so its destination is editable too. */
    it("is editable on a LOSRIT", async () => {
      await showTrip({ ...MANUAL, isLooseTrip: true });

      expect(
        screen.getByRole("button", { name: "Bestemming (stad, land)" }),
      ).toBeEnabled();
    });
  });

  /**
   * An imported Trip belongs to its document. A later UPDATE re-reads the
   * destination from the PDF, so anything typed here would be overwritten
   * without a word — and the backend refuses it outright. The cell is therefore
   * read-only exactly where a save could not succeed.
   */
  describe("the destination of an imported Trip", () => {
    it("is not editable", async () => {
      await showTrip({ pdfDocumentId: "pdf-1" });

      expect(
        screen.queryByRole("button", { name: "Bestemming (stad, land)" }),
      ).toBeNull();
    });

    it("is still shown", async () => {
      await showTrip({ pdfDocumentId: "pdf-1" });

      expect(screen.getByText("Dourges, France")).toBeInTheDocument();
    });

    it("stays read-only on a DELETED manual Trip", async () => {
      await showTrip({ ...MANUAL, status: "DELETED" });

      expect(
        screen.queryByRole("button", { name: "Bestemming (stad, land)" }),
      ).toBeNull();
    });
  });

  describe("presentation", () => {
    it("is translated", async () => {
      window.localStorage.setItem("tms.language", "tr");
      await showTrip({ ...MANUAL, isLooseTrip: true });

      expect(
        within(screen.getByRole("table")).getByText("LOSRIT"),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Varış yeri (şehir, ülke)" }),
      ).toBeInTheDocument();
    });

    it("translates the creation choice", async () => {
      window.localStorage.setItem("tms.language", "tr");
      respondWith(requestMock, { trips: buildPage([]) });
      renderRitten();

      await userEvent.click(
        await screen.findByRole("button", { name: "+ Yeni sefer" }),
      );

      expect(
        within(screen.getByRole("dialog")).getByLabelText("Tekil sefer"),
      ).toBeInTheDocument();
    });

    it.each(["light", "dark"])(
      "uses design tokens in %s mode",
      async (theme) => {
        document.documentElement.classList.toggle("dark", theme === "dark");
        await showTrip({ isLooseTrip: true });

        const badge = within(screen.getByRole("table")).getByText("LOSRIT");

        // No literal colour, and no lifecycle fill: it is not a state.
        expect(badge.className).not.toMatch(/#[0-9a-f]{3,8}/i);
        expect(badge.className).not.toMatch(/bg-(success|danger|info|warning)/);
        expect(badge.className).toMatch(/bg-hover/);
      },
    );
  });
});
