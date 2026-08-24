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

const FLAT = { id: "prop-flat", name: "Flat", isActive: true };
const TAR = { id: "prop-tar", name: "TAR", isActive: true };

/** The assignment as the backend reports it for a 20FL Trip. */
const REQUIRED_FLAT = {
  id: "assignment-flat",
  tripId: "trip-1",
  customPropertyId: FLAT.id,
  customProperty: FLAT,
  isAutomatic: true,
  isRequired: true,
};

const MANUAL_TAR = {
  id: "assignment-tar",
  tripId: "trip-1",
  customPropertyId: TAR.id,
  customProperty: TAR,
  isAutomatic: false,
  isRequired: false,
};

/**
 * The automatic Flat property, as an operator sees it.
 *
 * ── WHAT THE UI IS AND IS NOT RESPONSIBLE FOR ───────────────────────────────
 * It shows Flat exactly like any other Custom Property — no badge, no separate
 * column, nothing that says "automatic". An operator needs to see that the Trip
 * carries it, and where it came from changes nothing about that.
 *
 * The one thing it does differently is not offering a removal that would be
 * refused. WHICH assignments those are is the backend's answer, carried on each
 * one as `isRequired`; no container type is examined here. That is the point of
 * these tests — the day the rule changes to include another type, this UI is
 * already correct because it never knew the rule.
 * ────────────────────────────────────────────────────────────────────────────
 */
describe("the automatic Flat property in Ritten", () => {
  beforeEach(() => {
    requestMock.mockReset();
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  /** A 20FL Trip already carrying its Flat, as the list reports it. */
  function flatRackTrip() {
    return buildTrip({
      containerType: "20FL",
      customProperties: [
        { id: TAR.id, name: "TAR", isActive: true },
        { id: FLAT.id, name: "Flat", isActive: true },
      ],
    });
  }

  async function showFlatRack(
    assigned: unknown[] = [MANUAL_TAR, REQUIRED_FLAT],
  ): Promise<HTMLTableElement> {
    respondWith(requestMock, {
      trips: buildPage([flatRackTrip()]),
      assignedCustomProperties: assigned,
      availableCustomProperties: [TAR, FLAT],
    });

    renderRitten();

    return (await screen.findByRole("table")) as HTMLTableElement;
  }

  /** The action's label is itself translated, so the caller says which. */
  async function openPanel(label = "Custom waarden beheren"): Promise<HTMLElement> {
    await userEvent.click(
      await screen.findByRole("button", { name: `${label} ANRDUB2602247` }),
    );

    return screen.findByRole("dialog");
  }

  describe("the list", () => {
    it("shows Flat beside the other properties, like any other", async () => {
      const table = await showFlatRack();
      const row = within(table).getByText("ANRDUB2602247").closest("tr") as HTMLElement;

      expect(within(row).getByText(/Flat/)).toBeInTheDocument();
      expect(within(row).getByText(/TAR/)).toBeInTheDocument();
    });

    /** Nothing marks it as automatic — it is a property the Trip carries. */
    it("does not label it as automatic", async () => {
      const table = await showFlatRack();

      expect(within(table).queryByText(/automatisch/i)).not.toBeInTheDocument();
      expect(within(table).queryByText(REQUIRED_FLAT.id)).not.toBeInTheDocument();
    });

    it("shows it exactly once", async () => {
      const table = await showFlatRack();
      const row = within(table).getByText("ANRDUB2602247").closest("tr") as HTMLElement;

      expect(within(row).getAllByText(/Flat/)).toHaveLength(1);
    });
  });

  describe("the property panel", () => {
    it("shows Flat among the assigned properties", async () => {
      await showFlatRack();
      const dialog = await openPanel();

      expect(await within(dialog).findByText("Flat")).toBeInTheDocument();
    });

    it("offers no removal for it, and says why", async () => {
      await showFlatRack();
      const dialog = await openPanel();

      await within(dialog).findByText("Flat");
      const row = within(dialog).getByText("Flat").closest("li") as HTMLElement;

      expect(
        within(row).queryByRole("button", { name: "Verwijderen" }),
      ).not.toBeInTheDocument();
      expect(within(row).getByText("Verplicht")).toBeInTheDocument();
      expect(
        within(dialog).getByText(/verplicht voor containertype 20FL en 20ST/),
      ).toBeInTheDocument();
    });

    /** Only Flat is protected; the rest of the Trip stays editable. */
    it("still allows the other properties to be removed", async () => {
      await showFlatRack();
      const dialog = await openPanel();

      const row = (await within(dialog).findByText("TAR")).closest(
        "li",
      ) as HTMLElement;
      await userEvent.click(
        within(row).getByRole("button", { name: "Verwijderen" }),
      );

      await waitFor(() => {
        expect(requestMock).toHaveBeenCalledWith(
          "/api/v1/trip-custom-properties/assignment-tar",
          expect.objectContaining({ method: "DELETE" }),
        );
      });
    });

    /** Assigned means assigned: it cannot be added a second time. */
    it("does not offer Flat for assignment again", async () => {
      await showFlatRack();
      const dialog = await openPanel();

      await within(dialog).findByText("Flat");
      expect(
        within(dialog).queryByRole("button", { name: "+ Flat" }),
      ).not.toBeInTheDocument();
    });

    it("sends no request at all for a required property", async () => {
      await showFlatRack();
      const dialog = await openPanel();

      await within(dialog).findByText("Flat");

      expect(
        mutationCalls(requestMock).filter(([path]) =>
          String(path).includes("assignment-flat"),
        ),
      ).toHaveLength(0);
    });
  });

  /**
   * A Flat somebody assigned by hand to a Trip that does not require one —
   * the two CLOSED 45PH Trips in the real data are exactly this. Nothing about
   * it changes: it is theirs, and they can take it off again.
   */
  describe("a manually assigned Flat that is not required", () => {
    it("keeps its remove action", async () => {
      respondWith(requestMock, {
        trips: buildPage([buildTrip({ containerType: "45PH" })]),
        assignedCustomProperties: [
          {
            ...REQUIRED_FLAT,
            isAutomatic: false,
            isRequired: false,
          },
        ],
        availableCustomProperties: [FLAT],
      });

      renderRitten();
      await screen.findByRole("table");
      const dialog = await openPanel();

      const row = (await within(dialog).findByText("Flat")).closest(
        "li",
      ) as HTMLElement;
      await userEvent.click(
        within(row).getByRole("button", { name: "Verwijderen" }),
      );

      await waitFor(() => {
        expect(requestMock).toHaveBeenCalledWith(
          "/api/v1/trip-custom-properties/assignment-flat",
          expect.objectContaining({ method: "DELETE" }),
        );
      });
    });

    it("shows no requirement note", async () => {
      respondWith(requestMock, {
        trips: buildPage([buildTrip({ containerType: "45PH" })]),
        assignedCustomProperties: [
          { ...REQUIRED_FLAT, isAutomatic: false, isRequired: false },
        ],
      });

      renderRitten();
      await screen.findByRole("table");
      const dialog = await openPanel();

      await within(dialog).findByText("Flat");
      expect(
        within(dialog).queryByText(/verplicht voor containertype/),
      ).not.toBeInTheDocument();
    });
  });

  /**
   * The backend is the one that refuses, and its refusal is shown. This is a
   * race — the panel does not offer the removal — but a refusal must never be
   * silent.
   */
  it("shows the backend's refusal when a removal is rejected", async () => {
    respondWith(requestMock, {
      trips: buildPage([buildTrip({ containerType: "45PH" })]),
      assignedCustomProperties: [
        { ...REQUIRED_FLAT, isAutomatic: false, isRequired: false },
      ],
    });

    renderRitten();
    await screen.findByRole("table");
    const dialog = await openPanel();

    requestMock.mockRejectedValueOnce(
      new ApiError(
        "CONFLICT",
        'Trip "trip-1" has container type "20FL", which requires this Custom Property.',
        409,
      ),
    );

    const row = (await within(dialog).findByText("Flat")).closest(
      "li",
    ) as HTMLElement;
    await userEvent.click(
      within(row).getByRole("button", { name: "Verwijderen" }),
    );

    expect(
      await within(dialog).findByText(/requires this Custom Property/),
    ).toBeInTheDocument();
  });

  describe("presentation", () => {
    it("is translated", async () => {
      window.localStorage.setItem("tms.language", "tr");
      await showFlatRack();
      const dialog = await openPanel("Özel değerleri yönet");

      await within(dialog).findByText("Flat");

      expect(within(dialog).getByText("Zorunlu")).toBeInTheDocument();
      expect(
        within(dialog).getByText(/konteyner tipleri için zorunludur/),
      ).toBeInTheDocument();
    });

    it.each(["light", "dark"])("uses design tokens in %s mode", async (theme) => {
      document.documentElement.classList.toggle("dark", theme === "dark");
      await showFlatRack();
      const dialog = await openPanel();

      await within(dialog).findByText("Flat");

      expect(dialog.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(within(dialog).getByText("Verplicht")).toBeInTheDocument();
    });
  });
});
