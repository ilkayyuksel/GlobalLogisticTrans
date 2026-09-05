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
import type { Trip } from "@/lib/api/types";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

const requestMock = request as jest.MockedFunction<typeof request>;

/**
 * Taking the LOSRIT classification back off.
 *
 * ── THE LABEL, NEVER THE TRIP ───────────────────────────────────────────────
 * This is the mistake the wording exists to prevent. "Losrit verwijderen"
 * removes a classification from a Trip that stays exactly as it is; plain
 * "Verwijderen" removes the transport from the planning. The two sit in the
 * same row, and confusing them would be the worst possible outcome — so the
 * control says which it is, and the tests below assert that one PATCH carrying
 * a single field is all that happens.
 * ────────────────────────────────────────────────────────────────────────────
 */

const LOOSE: Partial<Trip> = { isLooseTrip: true };

function patchCalls() {
  return mutationCalls(requestMock).filter(
    ([path]) => String(path) === "/api/v1/trips/trip-1",
  );
}

function patchBody(): Record<string, unknown> | undefined {
  return (patchCalls()[0]?.[1] as { body?: Record<string, unknown> } | undefined)
    ?.body;
}

async function show(overrides: Partial<Trip> = {}): Promise<void> {
  respondWith(requestMock, { trips: buildPage([buildTrip(overrides)]) });
  renderRitten();
  await screen.findByRole("table");
}

function removeButton(name = "Losrit verwijderen ANRDUB2602247") {
  return screen.queryByRole("button", { name });
}

describe("removing the LOSRIT classification", () => {
  beforeEach(() => {
    requestMock.mockReset();
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  describe("where it is offered", () => {
    it("is offered on a Trip that carries the label", async () => {
      await show(LOOSE);

      expect(removeButton()).toBeEnabled();
    });

    it("is absent on an ordinary Trip", async () => {
      await show({ isLooseTrip: false });

      expect(removeButton()).toBeNull();
      expect(screen.queryByText("LOSRIT")).toBeNull();
    });

    /** The badge itself is the control; the marker still reads LOSRIT. */
    it("still shows the marker", async () => {
      await show(LOOSE);

      expect(
        within(screen.getByRole("table")).getByText("LOSRIT"),
      ).toBeInTheDocument();
    });

    it.each(["OPEN", "CLOSED", "CANCELLED"] as const)(
      "is offered whatever the status is (%s)",
      async (status) => {
        await show({ ...LOOSE, status });

        expect(removeButton()).toBeEnabled();
      },
    );
  });

  /** The wording is the whole safeguard against the obvious confusion. */
  describe("how it is worded", () => {
    it("says it removes the losrit, not the Trip", async () => {
      await show(LOOSE);

      expect(removeButton()).toHaveAccessibleName(
        "Losrit verwijderen ANRDUB2602247",
      );
    });

    it("is not the same control as deleting the Trip", async () => {
      await show(LOOSE);

      const deleteTrip = screen.getByRole("button", {
        name: "Verwijderen ANRDUB2602247",
      });

      expect(removeButton()).not.toBe(deleteTrip);
      expect(deleteTrip.className).toMatch(/danger/);
      // The classification control is not dressed as a destructive one.
      expect((removeButton() as HTMLElement).className).not.toMatch(/danger/);
    });
  });

  describe("what it sends", () => {
    it("clears the one field, through the ordinary update", async () => {
      await show(LOOSE);

      await userEvent.click(removeButton() as HTMLElement);

      await waitFor(() => {
        expect(requestMock).toHaveBeenCalledWith(
          "/api/v1/trips/trip-1",
          expect.objectContaining({
            method: "PATCH",
            body: { isLooseTrip: false },
          }),
        );
      });
    });

    it("sends nothing else at all", async () => {
      await show(LOOSE);

      await userEvent.click(removeButton() as HTMLElement);

      await waitFor(() => expect(patchBody()).toBeDefined());
      expect(Object.keys(patchBody() as object)).toEqual(["isLooseTrip"]);
    });

    /** Not a lifecycle action: no status endpoint, no deletion, no pricing. */
    it("touches no other endpoint", async () => {
      await show(LOOSE);

      await userEvent.click(removeButton() as HTMLElement);

      await waitFor(() => expect(patchCalls()).toHaveLength(1));
      expect(mutationCalls(requestMock)).toHaveLength(1);
      expect(
        requestMock.mock.calls.filter(([path]) =>
          String(path).includes("/trip-pricing/"),
        ),
      ).toHaveLength(0);
    });

    it("sends one request", async () => {
      await show(LOOSE);

      await userEvent.click(removeButton() as HTMLElement);

      await waitFor(() => expect(patchCalls()).toHaveLength(1));
    });
  });

  describe("afterwards", () => {
    it("says what happened", async () => {
      await show(LOOSE);

      await userEvent.click(removeButton() as HTMLElement);

      expect(
        await screen.findByText("Losrit-markering verwijderd"),
      ).toBeInTheDocument();
    });

    /** The Trip is still there, and still says everything it said before. */
    it("keeps the Trip on screen", async () => {
      await show(LOOSE);

      await userEvent.click(removeButton() as HTMLElement);

      await waitFor(() => expect(patchCalls()).toHaveLength(1));
      expect(screen.getByText("ANRDUB2602247")).toBeInTheDocument();
    });

    it("drops the marker once the refetched row no longer carries it", async () => {
      await show(LOOSE);

      respondWith(requestMock, {
        trips: buildPage([buildTrip({ isLooseTrip: false })]),
      });
      await userEvent.click(removeButton() as HTMLElement);

      await waitFor(() => {
        expect(screen.queryByText("LOSRIT")).toBeNull();
      });
    });

    it("reports a refusal rather than assuming it worked", async () => {
      await show(LOOSE);

      requestMock.mockRejectedValueOnce(
        new ApiError("CONFLICT", "Trip is DELETED.", 409),
      );
      await userEvent.click(removeButton() as HTMLElement);

      expect(await screen.findByText(/Trip is DELETED/)).toBeInTheDocument();
    });
  });

  describe("presentation", () => {
    it("is translated", async () => {
      window.localStorage.setItem("tms.language", "tr");
      await show(LOOSE);

      expect(
        await screen.findByRole("button", {
          name: "Tekil sefer işaretini kaldır ANRDUB2602247",
        }),
      ).toBeEnabled();
    });

    it.each(["light", "dark"])(
      "uses design tokens in %s mode",
      async (theme) => {
        document.documentElement.classList.toggle("dark", theme === "dark");
        await show(LOOSE);

        const control = removeButton() as HTMLElement;

        expect(control.className).toMatch(/bg-hover/);
        expect(control.className).not.toMatch(/#[0-9a-f]{3,8}/i);
        // Still not a lifecycle colour: it is a classification, not a state.
        expect(control.className).not.toMatch(/bg-(success|danger|info)/);
      },
    );
  });
});
