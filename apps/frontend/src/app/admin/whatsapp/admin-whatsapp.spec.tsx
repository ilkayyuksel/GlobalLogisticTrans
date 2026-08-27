import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import Page from "./page";
import { ApiError, request } from "@/lib/api/client";
import { LanguageProvider } from "@/lib/i18n/language-provider";
import { ThemeProvider } from "@/lib/theme/theme-provider";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

const requestMock = request as jest.MockedFunction<typeof request>;

/**
 * Admin → WhatsApp, the pairing screen.
 *
 * ── WHAT THESE TESTS DEFEND ─────────────────────────────────────────────────
 * That the QR appears for exactly ONE status and never for a transient
 * disconnect; that it disappears by itself once the account is linked, without
 * a browser refresh; and that polling stops when the page goes away. The last
 * one is not cosmetic — an interval that outlives its component keeps calling a
 * protected endpoint forever, on every page the operator visits afterwards.
 *
 * The page is rendered for real. Only the API client is replaced.
 */
const PAIRING_PATH = "/api/v1/whatsapp/pairing";

function renderPage({
  language,
  theme,
}: { language?: "nl" | "tr"; theme?: "light" | "dark" } = {}) {
  if (language) {
    window.localStorage.setItem("tms.language", language);
  }

  if (theme) {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }

  return render(
    <ThemeProvider>
      <LanguageProvider>
        <Page />
      </LanguageProvider>
    </ThemeProvider>,
  );
}

/** Answers the pairing endpoint, and nothing else. */
function respond(...answers: { status: string; qr: string | null }[]): void {
  let call = 0;

  requestMock.mockImplementation((...args: unknown[]) => {
    const [path] = args as [string];

    if (path !== PAIRING_PATH) {
      return Promise.reject(new Error(`unexpected path ${path}`));
    }

    const answer = answers[Math.min(call, answers.length - 1)];
    call += 1;

    return Promise.resolve(answer as never);
  });
}

function qr(): HTMLElement | null {
  return screen.queryByTestId("whatsapp-qr");
}

/**
 * The status line as a whole.
 *
 * Queried as an element rather than by its text: the line carries a coloured
 * dot beside the words, so the sentence is split across two nodes and a text
 * query matches neither of them.
 */
function status(): Promise<HTMLElement> {
  return screen.findByTestId("whatsapp-status");
}

function pairingCalls(): number {
  return requestMock.mock.calls.filter(([path]) => path === PAIRING_PATH).length;
}

beforeEach(() => {
  jest.useRealTimers();
  requestMock.mockReset();
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});

describe("the status the page shows", () => {
  it.each([
    ["CONNECTED", "Verbonden"],
    ["CONNECTING", "Verbinden…"],
    ["DISCONNECTED", "Verbinding verbroken — opnieuw verbinden…"],
    ["PAIRING_REQUIRED", "Koppeling vereist — scan QR-code"],
    ["ERROR", "WhatsApp is niet beschikbaar"],
    ["DISABLED", "WhatsApp staat uit in deze omgeving"],
  ])("says %s in the operator's own words", async (state, sentence) => {
    respond({ status: state, qr: state === "PAIRING_REQUIRED" ? "code" : null });
    renderPage();

    expect(await status()).toHaveTextContent(sentence);
  });

  it("reassures the operator when the account is linked", async () => {
    respond({ status: "CONNECTED", qr: null });
    renderPage();

    expect(
      await screen.findByText(/klaar om PDF.s te versturen/),
    ).toBeInTheDocument();
  });
});

describe("when the QR appears", () => {
  /** The one status that means somebody has to fetch their phone. */
  it("shows the QR while pairing is required", async () => {
    respond({ status: "PAIRING_REQUIRED", qr: "wa-code" });
    renderPage();

    await waitFor(() => expect(qr()).toBeInTheDocument());
  });

  it("shows the scanning instructions with it", async () => {
    respond({ status: "PAIRING_REQUIRED", qr: "wa-code" });
    renderPage();

    expect(
      await screen.findByText("Open WhatsApp op je telefoon"),
    ).toBeInTheDocument();
    expect(screen.getByText("Gekoppelde apparaten")).toBeInTheDocument();
    expect(screen.getByText("Scan deze QR-code")).toBeInTheDocument();
  });

  /**
   * The habit this whole area exists to avoid: telling an operator to scan a
   * code because a websocket blinked. Only PAIRING_REQUIRED means scan.
   */
  it.each(["CONNECTED", "CONNECTING", "DISCONNECTED", "ERROR", "DISABLED"])(
    "shows no QR while %s",
    async (state) => {
      respond({ status: state, qr: null });
      renderPage();

      await status();

      expect(qr()).not.toBeInTheDocument();
    },
  );

  /** Even if a code were somehow returned, the status decides. */
  it("shows no QR for a disconnected service that still carries one", async () => {
    respond({ status: "DISCONNECTED", qr: "stale-code" });
    renderPage();

    expect(await status()).toHaveTextContent("Verbinding verbroken");
    expect(qr()).not.toBeInTheDocument();
  });
});

describe("polling", () => {
  /** The scan happens on a phone; the page has to notice by itself. */
  it("removes the QR and reports CONNECTED without a refresh", async () => {
    respond(
      { status: "PAIRING_REQUIRED", qr: "wa-code" },
      { status: "CONNECTED", qr: null },
    );
    renderPage();

    await waitFor(() => expect(qr()).toBeInTheDocument());
    await waitFor(
      async () => expect(await status()).toHaveTextContent("Verbonden"),
      { timeout: 6_000 },
    );

    expect(qr()).not.toBeInTheDocument();
  });

  /** A reissued code replaces the previous one rather than accumulating. */
  it("draws the newest QR the service offers", async () => {
    respond(
      { status: "PAIRING_REQUIRED", qr: "first-code" },
      { status: "PAIRING_REQUIRED", qr: "second-code" },
    );
    renderPage();

    await waitFor(() => expect(qr()).toBeInTheDocument());
    await waitFor(() => expect(pairingCalls()).toBeGreaterThan(1), {
      timeout: 6_000,
    });

    expect(screen.getAllByTestId("whatsapp-qr")).toHaveLength(1);
  });

  it("polls the page once, not once per anything", async () => {
    respond({ status: "CONNECTED", qr: null });
    renderPage();

    await status();

    expect(pairingCalls()).toBe(1);
  });

  /**
   * An interval that outlives its page keeps calling a protected endpoint for
   * the rest of the session.
   */
  it("stops polling when the page is unmounted", async () => {
    respond({ status: "PAIRING_REQUIRED", qr: "wa-code" });
    const view = renderPage();

    await waitFor(() => expect(qr()).toBeInTheDocument());
    const afterMount = pairingCalls();

    view.unmount();
    await new Promise((resolve) => setTimeout(resolve, 4_000));

    expect(pairingCalls()).toBe(afterMount);
  }, 10_000);
});

describe("when the endpoint fails", () => {
  it("reports the failure rather than an empty page", async () => {
    requestMock.mockRejectedValue(
      new ApiError("UNAUTHORIZED", "Niet aangemeld.", 401),
    );
    renderPage();

    expect(await screen.findByText(/Niet aangemeld/)).toBeInTheDocument();
  });

  it("can be retried from the error state", async () => {
    requestMock.mockRejectedValueOnce(
      new ApiError("SERVICE_UNAVAILABLE", "Even niet bereikbaar.", 503),
    );
    renderPage();

    await screen.findByText(/Even niet bereikbaar/);
    respond({ status: "CONNECTED", qr: null });

    await userEvent.click(screen.getByRole("button", { name: /try again/i }));

    expect(await status()).toHaveTextContent("Verbonden");
  });
});

describe("presentation", () => {
  it("translates the page into Turkish", async () => {
    respond({ status: "PAIRING_REQUIRED", qr: "wa-code" });
    renderPage({ language: "tr" });

    expect(await status()).toHaveTextContent("Eşleştirme gerekli");
    expect(screen.getByText("Bu QR kodu okutun")).toBeInTheDocument();
  });

  /**
   * The QR keeps a white background in BOTH themes. A camera reads dark modules
   * on light ground; inverting it makes the code unscannable on many phones, so
   * this is the one element that deliberately ignores the theme.
   */
  it.each(["light", "dark"] as const)(
    "keeps the QR readable in %s mode",
    async (theme) => {
      respond({ status: "PAIRING_REQUIRED", qr: "wa-code" });
      renderPage({ theme });

      await waitFor(() => expect(qr()).toBeInTheDocument());

      expect(qr()?.className).toContain("bg-white");
    },
  );

  it("renders the rest of the page from theme tokens", async () => {
    respond({ status: "CONNECTED", qr: null });
    renderPage({ theme: "dark" });

    const line = await status();

    expect(line).toHaveTextContent("Verbonden");
    expect(line.className).toContain("text-foreground");
    expect(line.className).not.toMatch(/#[0-9a-f]{3,6}/i);
  });
});
