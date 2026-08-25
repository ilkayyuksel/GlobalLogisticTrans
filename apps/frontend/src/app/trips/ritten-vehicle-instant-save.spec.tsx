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

const requestMock = request as jest.MockedFunction<typeof request>;

/**
 * Picking a truck saves it.
 *
 * ── WHY THE SAVE BUTTON WENT ────────────────────────────────────────────────
 * Choosing from a list IS the decision. There is no half-finished state to
 * protect, the way there is while somebody is typing a container number and may
 * still change their mind — so a Save button after it only asked the operator
 * to confirm what they had just said, and planning a day's work cost twice the
 * clicks it needed to.
 *
 * ── NOTHING IS PAINTED OPTIMISTICALLY ───────────────────────────────────────
 * The cell closes only once the backend has accepted the change, and the row
 * then shows what the REFETCHED Trip says. A refusal leaves the previous truck
 * on screen with the backend's reason beside it: the frontend never decides
 * that something succeeded.
 * ────────────────────────────────────────────────────────────────────────────
 */

const VEHICLES = [
  { id: "vehicle-1", licensePlate: "1-ABC-123" },
  { id: "vehicle-2", licensePlate: "2-DEF-456" },
];

function patchCalls() {
  return mutationCalls(requestMock).filter(([path]) =>
    String(path).startsWith("/api/v1/trips/trip-1"),
  );
}

async function showTrip(overrides = {}): Promise<void> {
  respondWith(requestMock, {
    trips: buildPage([buildTrip({ vehicleId: "vehicle-1", ...overrides })]),
    vehicles: VEHICLES,
  });
  renderRitten();
  await screen.findByRole("table");
}

/**
 * Opens the cell and returns the SELECT.
 *
 * By role, not by label: the closed cell is a button carrying the same
 * accessible name, so a label query would match it too and a test could pass
 * against a cell that never opened.
 */
async function openPicker(label = "Voertuig"): Promise<HTMLElement> {
  await userEvent.click(await screen.findByRole("button", { name: label }));

  return screen.getByRole("combobox", { name: label });
}

describe("choosing a vehicle in the Ritten list", () => {
  beforeEach(() => {
    requestMock.mockReset();
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  describe("it saves at once", () => {
    it("sends the change as soon as an option is picked", async () => {
      await showTrip();

      const picker = await openPicker();
      await userEvent.selectOptions(picker, "vehicle-2");

      await waitFor(() => {
        expect(requestMock).toHaveBeenCalledWith(
          "/api/v1/trips/trip-1",
          expect.objectContaining({
            method: "PATCH",
            body: { vehicleId: "vehicle-2" },
          }),
        );
      });
    });

    it("offers no Save button at all", async () => {
      await showTrip();

      await openPicker();

      expect(
        screen.queryByRole("button", { name: "Opslaan" }),
      ).not.toBeInTheDocument();
    });

    it("clears the assignment the same way", async () => {
      await showTrip();

      const picker = await openPicker();
      await userEvent.selectOptions(picker, "");

      await waitFor(() => {
        expect(patchCalls()[0][1]).toMatchObject({
          body: { vehicleId: null },
        });
      });
    });

    it("sends one request for one change", async () => {
      await showTrip();

      const picker = await openPicker();
      await userEvent.selectOptions(picker, "vehicle-2");

      await waitFor(() => expect(patchCalls()).toHaveLength(1));
    });

    /** Opening the cell and closing it again is not a change. */
    it("sends nothing when the picker is merely opened", async () => {
      await showTrip();

      await openPicker();
      await userEvent.click(screen.getByRole("button", { name: "Annuleren" }));

      expect(patchCalls()).toHaveLength(0);
    });

    it("sends nothing for an unrelated action on the row", async () => {
      await showTrip();

      await userEvent.click(
        screen.getByRole("checkbox", { name: /^Selecteer rit / }),
      );

      expect(patchCalls()).toHaveLength(0);
    });

    /** Nothing is confirmed: this is an ordinary edit, made in one gesture. */
    it("asks nothing", async () => {
      const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
      await showTrip();

      const picker = await openPicker();
      await userEvent.selectOptions(picker, "vehicle-2");

      await waitFor(() => expect(patchCalls()).toHaveLength(1));
      expect(confirmSpy).not.toHaveBeenCalled();
      confirmSpy.mockRestore();
    });
  });

  describe("after the backend answers", () => {
    it("shows what the refetched Trip says", async () => {
      await showTrip();

      const picker = await openPicker();

      respondWith(requestMock, {
        trips: buildPage([
          buildTrip({
            vehicleId: "vehicle-2",
            vehicle: {
              id: "vehicle-2",
              licensePlate: "2-DEF-456",
              displayColor: "#2563eb",
              isActive: true,
            },
          }),
        ]),
        vehicles: VEHICLES,
      });

      await userEvent.selectOptions(picker, "vehicle-2");

      expect(await screen.findByText("2-DEF-456")).toBeInTheDocument();
    });

    it("closes the picker", async () => {
      await showTrip();

      const picker = await openPicker();
      await userEvent.selectOptions(picker, "vehicle-2");

      // The page's own vehicle FILTER is a combobox too, so the cell's editor
      // is identified by its accessible name rather than by role alone.
      await waitFor(() => {
        expect(
          screen.queryByRole("combobox", { name: "Voertuig" }),
        ).not.toBeInTheDocument();
      });
    });

    /** No page reload — the list refetches in place. */
    it("stays on the same list", async () => {
      await showTrip();

      const picker = await openPicker();
      await userEvent.selectOptions(picker, "vehicle-2");

      await waitFor(() => expect(patchCalls()).toHaveLength(1));
      expect(screen.getByRole("table")).toBeInTheDocument();
    });
  });

  describe("when the backend refuses", () => {
    async function refuse(): Promise<void> {
      await showTrip();

      const picker = await openPicker();
      requestMock.mockRejectedValueOnce(
        new ApiError(
          "CONFLICT",
          'The vehicle "vehicle-2" is inactive and cannot be assigned to a Trip.',
          409,
        ),
      );
      await userEvent.selectOptions(picker, "vehicle-2");
    }

    it("keeps the previous vehicle on the row", async () => {
      await refuse();

      await screen.findAllByText(/is inactive and cannot be assigned/);
      // The row behind the open cell still shows the truck that is really set.
      expect(screen.getAllByText("1-ABC-123").length).toBeGreaterThan(0);
    });

    it("says why, in the backend's own words", async () => {
      await refuse();

      // Twice: in the cell, which stays open, and in the page's feedback line.
      expect(
        await screen.findAllByText(/is inactive and cannot be assigned/),
      ).not.toHaveLength(0);
    });

    it("leaves the picker open so it can be tried again", async () => {
      await refuse();

      await screen.findAllByText(/is inactive and cannot be assigned/);
      expect(
        screen.getByRole("combobox", { name: "Voertuig" }),
      ).toBeInTheDocument();
    });

    it("lets a second choice be made", async () => {
      await refuse();
      await screen.findAllByText(/is inactive and cannot be assigned/);

      await userEvent.selectOptions(
        screen.getByRole("combobox", { name: "Voertuig" }),
        "",
      );

      await waitFor(() => {
        expect(patchCalls()).toHaveLength(2);
      });
    });
  });

  /**
   * Planning a Trip onto a truck says nothing about who drives it. The driver
   * comes from the VehicleAssignment, resolved by the backend, and this change
   * neither reads nor writes one.
   */
  describe("the driver", () => {
    it("is not sent with the vehicle", async () => {
      await showTrip();

      const picker = await openPicker();
      await userEvent.selectOptions(picker, "vehicle-2");

      await waitFor(() => expect(patchCalls()).toHaveLength(1));
      expect(patchCalls()[0][1]).toMatchObject({
        body: { vehicleId: "vehicle-2" },
      });
      expect(
        Object.keys((patchCalls()[0][1] as { body: object }).body),
      ).toEqual(["vehicleId"]);
    });

    it("touches no vehicle assignment", async () => {
      await showTrip();

      const picker = await openPicker();
      await userEvent.selectOptions(picker, "vehicle-2");

      await waitFor(() => expect(patchCalls()).toHaveLength(1));
      expect(
        mutationCalls(requestMock).filter(([path]) =>
          String(path).includes("assignment"),
        ),
      ).toHaveLength(0);
    });
  });

  describe("presentation", () => {
    it("is translated", async () => {
      window.localStorage.setItem("tms.language", "tr");
      await showTrip();

      const picker = await openPicker("Araç");
      await userEvent.selectOptions(picker, "vehicle-2");

      await waitFor(() => expect(patchCalls()).toHaveLength(1));
      expect(screen.queryByRole("button", { name: "Kaydet" })).toBeNull();
    });

    it.each(["light", "dark"])(
      "uses design tokens in %s mode",
      async (theme) => {
        document.documentElement.classList.toggle("dark", theme === "dark");
        await showTrip();

        const picker = await openPicker();
        const editor = picker.closest("div") as HTMLElement;

        expect(editor.className).toMatch(/bg-card|border-primary/);
        expect(editor.innerHTML).not.toMatch(/#[0-9a-f]{3,8}/i);
      },
    );

    it("still names the field for a screen reader", async () => {
      await showTrip();

      expect(await openPicker()).toHaveAccessibleName("Voertuig");
    });
  });

  /** The rest of the table still asks for a Save: only a CHOICE saves itself. */
  describe("typed cells are unaffected", () => {
    it("still offers Save for the container number", async () => {
      await showTrip();

      await userEvent.click(
        screen.getByRole("button", { name: "Containernummer" }),
      );

      expect(
        within(
          screen
            .getByRole("textbox", { name: "Containernummer" })
            .closest("div") as HTMLElement,
        ).getByRole("button", { name: "Opslaan" }),
      ).toBeInTheDocument();
    });

    it("sends nothing until that Save is pressed", async () => {
      await showTrip();

      await userEvent.click(
        screen.getByRole("button", { name: "Containernummer" }),
      );
      await userEvent.type(
        screen.getByRole("textbox", { name: "Containernummer" }),
        "X",
      );

      expect(patchCalls()).toHaveLength(0);
    });
  });
});
