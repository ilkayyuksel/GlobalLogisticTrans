import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import CustomValuesPage from "./page";
import { ApiError, request } from "@/lib/api/client";
import type { CustomProperty, Paginated } from "@/lib/api/types";
import { LanguageProvider } from "@/lib/i18n/language-provider";
import { ThemeProvider } from "@/lib/theme/theme-provider";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

const requestMock = request as jest.MockedFunction<typeof request>;

/**
 * Deleting a Custom Property from the settings page.
 *
 * ── WHAT THESE TESTS GUARD ──────────────────────────────────────────────────
 * Deletion is PERMANENT, so the interesting cases are the ones where nothing
 * should happen: cancelling, a system-managed property, and a refusal from the
 * backend. In particular:
 *
 *   the confirmation NAMES the property, which `window.confirm` cannot do;
 *   cancelling sends no request at all;
 *   a 409 keeps the dialog open with the backend's own sentence, so an
 *     operator reads which dependency blocked it rather than a generic failure;
 *   and the row is gone from the list only after the backend accepted.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** An ordinary property: no component link, not TAR, not Flat. */
const ORDINARY: CustomProperty = {
  id: "prop-uncoupling",
  name: "Aan/Afkoppelen",
  description: "Container af- en aankoppelen",
  pricingComponentId: null,
  defaultPrice: "25.00",
  isActive: true,
  isSystemManaged: false,
};

/** TAR: the Pricing Engine applies it, so the system owns the row. */
const SYSTEM_MANAGED: CustomProperty = {
  id: "prop-tar",
  name: "TAR",
  description: null,
  pricingComponentId: null,
  defaultPrice: "35.00",
  isActive: true,
  isSystemManaged: true,
};

function page(items: CustomProperty[]): Paginated<CustomProperty> {
  return {
    items,
    meta: { page: 1, pageSize: 100, totalItems: items.length, totalPages: 1 },
  };
}

/**
 * Serves the list, and lets a test decide what a DELETE does.
 *
 * The list is served from a mutable array so a successful delete can be
 * reflected in the refetch, which is how the row actually leaves the table.
 */
function respondWith(
  items: CustomProperty[],
  onDelete: () => unknown = () => ORDINARY,
): { remaining: CustomProperty[] } {
  const state = { remaining: [...items] };

  requestMock.mockImplementation((...args: unknown[]) => {
    const [, options] = args as [string, { method?: string } | undefined];
    const method = options?.method ?? "GET";

    if (method === "DELETE") {
      return Promise.resolve(onDelete()) as Promise<never>;
    }

    if (method !== "GET") {
      return Promise.resolve(ORDINARY) as Promise<never>;
    }

    return Promise.resolve(page(state.remaining)) as Promise<never>;
  });

  return state;
}

function deleteCalls() {
  return requestMock.mock.calls.filter(
    ([, options]) =>
      (options as { method?: string } | undefined)?.method === "DELETE",
  );
}

function renderPage() {
  return render(
    <ThemeProvider>
      <LanguageProvider>
        <CustomValuesPage />
      </LanguageProvider>
    </ThemeProvider>,
  );
}

async function showList(
  items: CustomProperty[] = [ORDINARY, SYSTEM_MANAGED],
  onDelete?: () => unknown,
): Promise<{ remaining: CustomProperty[] }> {
  const state = respondWith(items, onDelete);
  renderPage();
  await screen.findByText(items[0].name);

  return state;
}

/**
 * The row's own Verwijderen, scoped to the table.
 *
 * Once the confirmation is open there are TWO buttons with this name — the row
 * and the dialog's confirm — so both helpers say which one they mean.
 */
function deleteButton(): HTMLElement {
  return within(screen.getByRole("table")).getByRole("button", {
    name: "Verwijderen",
  });
}

/** The confirming button inside the dialog. */
async function confirmButton(): Promise<HTMLElement> {
  return within(await screen.findByRole("dialog")).getByRole("button", {
    name: "Verwijderen",
  });
}

beforeEach(() => {
  requestMock.mockReset();
  window.localStorage.clear();
});

describe("deleting a custom value", () => {
  it("offers Verwijderen on an ordinary property", async () => {
    await showList();

    expect(deleteButton()).toBeInTheDocument();
  });

  /** The row keeps everything it had; delete is an addition, not a swap. */
  it("keeps Bewerken and Deactiveren alongside it", async () => {
    await showList([ORDINARY]);

    expect(screen.getByRole("button", { name: "Bewerken" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Deactiveren" }),
    ).toBeInTheDocument();
  });

  /**
   * The system owns TAR, Flat, Toll and Tunnel. The backend refuses to delete
   * them; the button is simply not offered, so nobody is invited to try.
   */
  it("offers no delete on a system-managed property", async () => {
    await showList([SYSTEM_MANAGED]);

    expect(
      screen.queryByRole("button", { name: "Verwijderen" }),
    ).not.toBeInTheDocument();
  });

  describe("the confirmation", () => {
    it("opens a dialog rather than a browser confirm", async () => {
      const confirmSpy = jest
        .spyOn(window, "confirm")
        .mockReturnValue(true);

      await showList();
      await userEvent.click(deleteButton());

      expect(await screen.findByRole("dialog")).toBeInTheDocument();
      expect(confirmSpy).not.toHaveBeenCalled();

      confirmSpy.mockRestore();
    });

    it("names the property that will be deleted", async () => {
      await showList();

      await userEvent.click(deleteButton());

      const dialog = await screen.findByRole("dialog");

      expect(dialog).toHaveTextContent("Aan/Afkoppelen");
    });

    it("says the deletion is permanent", async () => {
      await showList();

      await userEvent.click(deleteButton());

      expect(await screen.findByRole("dialog")).toHaveTextContent(
        /definitief uit de database verwijderd/i,
      );
    });

    it("sends nothing until it is confirmed", async () => {
      await showList();

      await userEvent.click(deleteButton());
      await screen.findByRole("dialog");

      expect(deleteCalls()).toHaveLength(0);
    });
  });

  describe("cancelling", () => {
    it("writes nothing", async () => {
      await showList();

      await userEvent.click(deleteButton());
      await screen.findByRole("dialog");
      await userEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", { name: "Sluiten" }),
      );

      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
      expect(deleteCalls()).toHaveLength(0);
    });

    /** The property is still there afterwards, untouched. */
    it("leaves the property in the list", async () => {
      await showList();

      await userEvent.click(deleteButton());
      await screen.findByRole("dialog");
      await userEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", { name: "Sluiten" }),
      );

      expect(await screen.findByText("Aan/Afkoppelen")).toBeInTheDocument();
    });
  });

  describe("confirming", () => {
    async function confirmDelete(): Promise<void> {
      await userEvent.click(deleteButton());
      await screen.findByRole("dialog");
      await userEvent.click(await confirmButton());
    }

    it("calls DELETE on the property's own resource", async () => {
      const state = await showList();
      state.remaining = [SYSTEM_MANAGED];

      await confirmDelete();

      await waitFor(() => expect(deleteCalls()).toHaveLength(1));
      expect(deleteCalls()[0][0]).toBe(
        "/api/v1/custom-properties/prop-uncoupling",
      );
    });

    /** Never a deactivation dressed up as a delete. */
    it("never falls back to the deactivation endpoint", async () => {
      const state = await showList();
      state.remaining = [SYSTEM_MANAGED];

      await confirmDelete();

      await waitFor(() => expect(deleteCalls()).toHaveLength(1));
      for (const [path, options] of requestMock.mock.calls) {
        expect(String(path)).not.toContain("/deactivation");
        expect((options as { method?: string } | undefined)?.method).not.toBe(
          "PATCH",
        );
      }
    });

    it("closes the dialog and drops the row from the list", async () => {
      const state = await showList();
      // What the refetched list answers once the row is gone.
      state.remaining = [SYSTEM_MANAGED];

      await confirmDelete();

      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
      await waitFor(() =>
        expect(screen.queryByText("Aan/Afkoppelen")).not.toBeInTheDocument(),
      );
    });

    it("confirms that it was deleted", async () => {
      const state = await showList();
      state.remaining = [SYSTEM_MANAGED];

      await confirmDelete();

      expect(
        await screen.findByText(/definitief verwijderd/i),
      ).toBeInTheDocument();
    });
  });

  /**
   * The backend is the only thing that knows whether a delete is safe, so its
   * refusal has to survive all the way to the screen.
   */
  describe("when the backend refuses", () => {
    const IN_USE =
      'Custom property "Aan/Afkoppelen" is still assigned to 3 Trips. Remove those assignments first, or deactivate the property instead.';

    async function refuse(message = IN_USE): Promise<void> {
      await showList([ORDINARY, SYSTEM_MANAGED], () => {
        throw new ApiError("CONFLICT", message, 409);
      });

      await userEvent.click(deleteButton());
      await screen.findByRole("dialog");
      await userEvent.click(await confirmButton());
    }

    it("keeps the dialog open", async () => {
      await refuse();

      expect(await screen.findByRole("dialog")).toBeInTheDocument();
    });

    /**
     * Shown in BOTH places, which is why each assertion says which one it
     * means: the dialog states it where the decision is being made, and the
     * page's feedback banner keeps it after the dialog is dismissed.
     */
    it("shows which dependency blocked it, in the backend's own words", async () => {
      await refuse();

      const dialog = await screen.findByRole("dialog");

      expect(within(dialog).getByRole("alert")).toHaveTextContent(
        /still assigned to 3 Trips/,
      );
    });

    it("repeats it in the page feedback", async () => {
      await refuse();

      await waitFor(() =>
        expect(
          screen.getAllByText(IN_USE, { exact: false }).length,
        ).toBeGreaterThan(1),
      );
    });

    it("leaves the property in the list", async () => {
      await refuse();

      expect(
        within(screen.getByRole("table")).getByText("Aan/Afkoppelen"),
      ).toBeInTheDocument();
    });

    /** Frozen pricing produces its own sentence, and it reaches the screen too. */
    it("reports a pricing-history refusal just as plainly", async () => {
      await refuse(
        'Custom property "Aan/Afkoppelen" appears in 2 frozen pricing lines. Historical pricing must stay explainable, so it cannot be deleted. Deactivate it instead.',
      );

      const dialog = await screen.findByRole("dialog");

      expect(within(dialog).getByRole("alert")).toHaveTextContent(
        /appears in 2 frozen pricing lines/,
      );
    });
  });
});
