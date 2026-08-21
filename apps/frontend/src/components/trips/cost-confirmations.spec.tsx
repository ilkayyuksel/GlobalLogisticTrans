import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CostConfirmations } from "./cost-confirmations";
import type { CostConfirmation } from "@/lib/api/types";
import { LanguageProvider } from "@/lib/i18n/language-provider";
import { ThemeProvider } from "@/lib/theme/theme-provider";

/**
 * What Eucon confirmed, on the Trip page.
 *
 * ── WHAT THESE TESTS GUARD ──────────────────────────────────────────────────
 *   1. the amount is READ-ONLY — no input, no edit, no delete, because there is
 *      no endpoint for any of them and an interface that implied otherwise
 *      would be offering to rewrite somebody else's statement;
 *   2. there is exactly ONE or none — never a list, because a Trip's waiting
 *      time is confirmed once;
 *   3. it is never presented as the waiting time.
 * ────────────────────────────────────────────────────────────────────────────
 */

function buildConfirmation(
  overrides: Partial<CostConfirmation> = {},
): CostConfirmation {
  return {
    id: "cc-1",
    ccNumber: "4139505",
    costCode: "WAIT",
    amount: "27.50",
    currency: "EUR",
    receivedAt: "2026-08-21T09:00:00.000Z",
    pdfDocumentId: "pdf-cc-1",
    ...overrides,
  };
}

function renderPanel(
  confirmation: CostConfirmation | null,
  onView = jest.fn(),
  onDownload = jest.fn(),
) {
  render(
    <ThemeProvider>
      <LanguageProvider>
        <CostConfirmations
          confirmation={confirmation}
          onView={onView}
          onDownload={onDownload}
        />
      </LanguageProvider>
    </ThemeProvider>,
  );

  return { onView, onDownload };
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});

describe("the cost confirmations of a Trip", () => {
  it("shows the number with its CC prefix and the amount", () => {
    renderPanel(buildConfirmation());

    expect(screen.getByText("CC4139505")).toBeInTheDocument();
    expect(screen.getByText("EUR 27.50")).toBeInTheDocument();
  });

  it("shows what the cost was confirmed for", () => {
    renderPanel(buildConfirmation());

    expect(screen.getByText("WAIT")).toBeInTheDocument();
  });

  it("shows when it was received", () => {
    const { container } = render(
      <ThemeProvider>
        <LanguageProvider>
          <CostConfirmations
            confirmation={buildConfirmation()}
            onView={jest.fn()}
            onDownload={jest.fn()}
          />
        </LanguageProvider>
      </ThemeProvider>,
    );

    expect(container.querySelector("time")).not.toBeNull();
  });

  /** The whole point: an external statement nobody here may rewrite. */
  it("offers no way to change the amount", () => {
    renderPanel(buildConfirmation());

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /bewerk|wijzig|verwijder/i }),
    ).toBeNull();
  });

  it("says the amount is not ours to change", () => {
    renderPanel(buildConfirmation());

    expect(
      screen.getByText(/kan niet worden aangepast/),
    ).toBeInTheDocument();
  });

  /** Two numbers about the same delay invite exactly this confusion. */
  it("says it does not replace the entered waiting time", () => {
    renderPanel(buildConfirmation());

    expect(
      screen.getByText(/vervangt de ingevoerde wachttijd niet/),
    ).toBeInTheDocument();
  });

  /**
   * A Trip has one confirmed cost, so the panel renders one value rather than
   * a list. A second, different confirmation never reaches this component: the
   * backend refuses it and the first one stands.
   */
  it("shows a single confirmation rather than a list", () => {
    renderPanel(buildConfirmation());

    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByText("CC4139505")).toBeInTheDocument();
    expect(screen.getByText("EUR 27.50")).toBeInTheDocument();
  });

  it("says so when nothing has been confirmed", () => {
    renderPanel(null);

    expect(screen.getByText("Nog geen kostenbevestiging")).toBeInTheDocument();
    // Not a zero: nothing confirmed is not "confirmed at nothing".
    expect(screen.queryByText(/0[.,]00/)).toBeNull();
  });

  describe("the document", () => {
    it("can be viewed and downloaded", async () => {
      const user = userEvent.setup();
      const { onView, onDownload } = renderPanel(buildConfirmation());

      await user.click(screen.getByRole("button", { name: "Bekijken" }));
      await user.click(screen.getByRole("button", { name: "Downloaden" }));

      expect(onView).toHaveBeenCalledWith("pdf-cc-1");
      expect(onDownload).toHaveBeenCalledWith(
        expect.objectContaining({ ccNumber: "4139505" }),
      );
    });
  });

  describe("presentation", () => {
    it("is translated", () => {
      window.localStorage.setItem("tms.language", "tr");
      renderPanel(buildConfirmation());

      expect(screen.getByText("Maliyet onayı")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Görüntüle" }),
      ).toBeInTheDocument();
      expect(screen.getByText(/değiştirilemez/)).toBeInTheDocument();
    });

    it.each(["light", "dark"])("uses design tokens in %s mode", (theme) => {
      document.documentElement.classList.toggle("dark", theme === "dark");
      const { container } = render(
        <ThemeProvider>
          <LanguageProvider>
            <CostConfirmations
              confirmation={buildConfirmation()}
              onView={jest.fn()}
              onDownload={jest.fn()}
            />
          </LanguageProvider>
        </ThemeProvider>,
      );

      const panel = within(container).getByText("CC4139505").closest("section");

      expect(panel?.outerHTML).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    });
  });
});
