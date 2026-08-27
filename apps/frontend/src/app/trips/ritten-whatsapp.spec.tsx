import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
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

/**
 * "Versturen" — the transport order to the driver, from the Ritten list.
 *
 * ── WHAT THESE TESTS DEFEND ─────────────────────────────────────────────────
 * That the button is offered exactly where a send can work, that it says WHY
 * when it cannot, that one click produces one request, and that it never asks
 * for confirmation. The last is easy to lose by accident and expensive to have:
 * a dialog in front of a routine action trains people to dismiss dialogs.
 *
 * Nothing here mocks the button. The real page, the real availability rule and
 * the real translations run; only the API client is replaced.
 */
const SEND_PATH = "/api/v1/trips/trip-1/whatsapp/send-pdf";

/** The send control, by the accessible name the specification requires. */
function sendButton(): HTMLElement {
  return screen.getByRole("button", {
    name: /PDF naar chauffeur versturen/i,
  });
}

function sendCalls() {
  return requestMock.mock.calls.filter(([path]) => path === SEND_PATH);
}

beforeEach(() => {
  requestMock.mockReset();
  /*
   * The language and the theme live in localStorage and on <html>, and neither
   * is reset between tests by the framework. Without this the Turkish and
   * dark-mode cases below leak into every test declared after them.
   */
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});

describe("when the Trip can be sent for", () => {
  beforeEach(() => {
    respondWith(requestMock, { trips: buildPage([buildTrip()]) });
  });

  it("offers the button, enabled", async () => {
    renderRitten();

    await waitFor(() => expect(sendButton()).toBeEnabled());
  });

  it("names the driver in its accessible name", async () => {
    renderRitten();

    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "PDF naar chauffeur versturen: Piet Janssens",
        }),
      ).toBeInTheDocument(),
    );
  });

  it("sends one request for one click", async () => {
    renderRitten();
    await waitFor(() => expect(sendButton()).toBeEnabled());

    await userEvent.click(sendButton());

    await waitFor(() => expect(sendCalls()).toHaveLength(1));
    expect(sendCalls()[0][1]).toMatchObject({ method: "POST" });
  });

  /**
   * Deleting asks. This does not: the worst outcome is a driver receiving the
   * same PDF twice, and a dialog in front of a routine action is one people
   * learn to dismiss without reading.
   */
  it("asks for no confirmation", async () => {
    renderRitten();
    await waitFor(() => expect(sendButton()).toBeEnabled());

    await userEvent.click(sendButton());

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(sendCalls()).toHaveLength(1));
  });

  it("reports success, naming the driver who received it", async () => {
    renderRitten();
    await waitFor(() => expect(sendButton()).toBeEnabled());

    await userEvent.click(sendButton());

    await waitFor(() =>
      expect(
        screen.getByText(/PDF verzonden naar Piet Janssens/),
      ).toBeInTheDocument(),
    );
  });

});

describe("when the send is refused", () => {
  /** The backend's own sentence, never a status code or a stack. */
  it("reports the failure in the backend's words", async () => {
    respondWith(requestMock, {
      trips: buildPage([buildTrip()]),
      sendFailureMessage:
        "WhatsApp is niet verbonden. Probeer het zo dadelijk opnieuw.",
    });
    renderRitten();
    await waitFor(() => expect(sendButton()).toBeEnabled());

    await userEvent.click(sendButton());

    const status = await screen.findByRole("status");

    expect(status).toHaveTextContent("PDF kon niet worden verzonden");
    expect(status).toHaveTextContent("WhatsApp is niet verbonden");
  });

  /** A refusal must leave the row usable, or one failure strands the Trip. */
  it("re-enables the button afterwards", async () => {
    respondWith(requestMock, {
      trips: buildPage([buildTrip()]),
      sendFailureMessage: "WhatsApp is niet verbonden.",
    });
    renderRitten();
    await waitFor(() => expect(sendButton()).toBeEnabled());

    await userEvent.click(sendButton());
    await screen.findByRole("status");

    await waitFor(() => expect(sendButton()).toBeEnabled());
  });
});

/**
 * In-flight protection only. A second click DURING the request must not produce
 * a second WhatsApp message; two sends a minute apart remain a legitimate thing
 * for an operator to want, so nothing here deduplicates beyond the request.
 */
describe("while a send is running", () => {
  it("refuses a second click until the first has answered", async () => {
    /*
     * A holder rather than a bare `let`. TypeScript cannot see that a closure
     * assigns the variable, so it narrows a `let` to `never` and the call at
     * the end of this test stops compiling.
     */
    const pending = { release: () => undefined as void };
    respondWith(requestMock, { trips: buildPage([buildTrip()]) });
    renderRitten();
    await waitFor(() => expect(sendButton()).toBeEnabled());

    /*
     * Replaces the send route ONLY, and only once the page has finished
     * loading — so the hanging promise cannot be consumed by the Trip list or
     * the status request, which is what made an earlier `...Once` version of
     * this test fail and poison the one after it.
     */
    const settled = requestMock.getMockImplementation() as (
      path: string,
      options?: unknown,
    ) => Promise<unknown>;

    requestMock.mockImplementation(((
      path: string,
      options?: unknown,
    ): Promise<unknown> => {
      if (path === SEND_PATH) {
        return new Promise((resolve) => {
          pending.release = () =>
            resolve({
              delivered: true,
              driverName: "Piet Janssens",
              filename: "transport-order.pdf",
            });
        });
      }

      return settled(path, options);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any);

    await userEvent.click(sendButton());

    await waitFor(() => expect(sendButton()).toBeDisabled());
    expect(sendButton()).toHaveTextContent("Versturen…");

    await userEvent.click(sendButton());

    expect(sendCalls()).toHaveLength(1);

    pending.release();
    await waitFor(() => expect(sendButton()).toBeEnabled());
    expect(sendCalls()).toHaveLength(1);
  });
});

describe("when the Trip cannot be sent for", () => {
  /** A row with nobody to send to still shows the button, explaining itself. */
  it("disables it and says so when no driver is linked", async () => {
    respondWith(requestMock, {
      trips: buildPage([buildTrip({ effectiveDriver: null })]),
    });
    renderRitten();

    await waitFor(() => expect(sendButton()).toBeDisabled());
    expect(sendButton()).toHaveAttribute("title", "Geen chauffeur gekoppeld");
  });

  it("disables it and says so when the driver has no phone number", async () => {
    respondWith(requestMock, {
      trips: buildPage([
        buildTrip({
          effectiveDriver: {
            id: "driver-1",
            name: "Piet Janssens",
            isActive: true,
            source: "VEHICLE_ASSIGNMENT",
            hasPhoneNumber: false,
          },
        }),
      ]),
    });
    renderRitten();

    await waitFor(() => expect(sendButton()).toBeDisabled());
    expect(sendButton()).toHaveAttribute(
      "title",
      "Geen telefoonnummer voor deze chauffeur",
    );
  });

  it("disables it and says so when the Trip has no transport order", async () => {
    respondWith(requestMock, {
      trips: buildPage([buildTrip({ pdfDocumentId: null })]),
    });
    renderRitten();

    await waitFor(() => expect(sendButton()).toBeDisabled());
    expect(sendButton()).toHaveAttribute(
      "title",
      "Geen transportopdracht beschikbaar",
    );
  });

  /**
   * Each connection state gets its OWN sentence. They used to share one — "niet
   * verbonden" — which reads as a fault in all four cases and is true in one. A
   * service that is reconnecting needs nothing from the operator; a service
   * that lost its pairing needs somebody with a phone. Saying "scan a QR code"
   * for a two-second network blip is the habit this phase removed.
   */
  it.each([
    ["CONNECTING", "Verbinden…"],
    ["DISCONNECTED", "Verbinding verbroken — opnieuw verbinden…"],
    ["PAIRING_REQUIRED", "Koppeling vereist — scan QR-code"],
    ["ERROR", "WhatsApp is niet beschikbaar"],
    ["DISABLED", "WhatsApp staat uit in deze omgeving"],
  ])("disables it and explains %s in its own words", async (status, sentence) => {
    respondWith(requestMock, {
      trips: buildPage([buildTrip()]),
      whatsAppStatus: status,
    });
    renderRitten();

    await waitFor(() => expect(sendButton()).toBeDisabled());
    expect(sendButton()).toHaveAttribute("title", sentence);
  });

  /** A transient drop must never be dressed up as a pairing problem. */
  it("does not mention the QR code while merely reconnecting", async () => {
    respondWith(requestMock, {
      trips: buildPage([buildTrip()]),
      whatsAppStatus: "DISCONNECTED",
    });
    renderRitten();

    await waitFor(() => expect(sendButton()).toBeDisabled());
    expect(sendButton().getAttribute("title")).not.toMatch(/QR/i);
    expect(sendButton().getAttribute("title")).not.toMatch(/koppeling/i);
  });

  it("never reaches the backend while disabled", async () => {
    respondWith(requestMock, {
      trips: buildPage([buildTrip({ effectiveDriver: null })]),
    });
    renderRitten();
    await waitFor(() => expect(sendButton()).toBeDisabled());

    await userEvent.click(sendButton());

    expect(sendCalls()).toHaveLength(0);
  });

  /**
   * Hidden rather than disabled: a cancelled transport is not waiting for
   * anything to be fixed, so a permanently dead control in its row would be
   * clutter rather than explanation.
   */
  it.each(["CANCELLED", "DELETED"] as const)(
    "hides the button entirely for a %s Trip",
    async (status) => {
      respondWith(requestMock, {
        trips: buildPage([buildTrip({ status })]),
      });
      renderRitten();

      await waitFor(() =>
        expect(screen.getByText("ANRDUB2602247")).toBeInTheDocument(),
      );
      expect(
        screen.queryByRole("button", { name: /PDF naar chauffeur versturen/i }),
      ).not.toBeInTheDocument();
    },
  );
});

describe("in Turkish", () => {
  it("labels and explains the button in the chosen language", async () => {
    respondWith(requestMock, {
      trips: buildPage([buildTrip({ effectiveDriver: null })]),
    });
    renderRitten({ language: "tr" });

    const button = await screen.findByRole("button", {
      name: /PDF.{0,3}yi şoföre gönder/i,
    });

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Bağlı şoför yok");
  });

  it("reports a successful send in Turkish", async () => {
    respondWith(requestMock, { trips: buildPage([buildTrip()]) });
    renderRitten({ language: "tr" });

    const button = await screen.findByRole("button", {
      name: /PDF.{0,3}yi şoföre gönder/i,
    });
    await waitFor(() => expect(button).toBeEnabled());

    await userEvent.click(button);

    await waitFor(() =>
      expect(
        screen.getByText(/PDF Piet Janssens adlı sürücüye gönderildi/),
      ).toBeInTheDocument(),
    );
  });
});

describe("in both themes", () => {
  /**
   * The button uses the project's own `success` token rather than a literal
   * colour, which is what makes it legible in dark mode. Asserting the class
   * is asserting that it opted into the theme system at all.
   */
  it.each(["light", "dark"] as const)(
    "uses themed colour tokens in %s mode",
    async (theme) => {
      respondWith(requestMock, { trips: buildPage([buildTrip()]) });
      renderRitten({ theme });

      await waitFor(() => expect(sendButton()).toBeEnabled());
      expect(sendButton().className).toContain("text-success");
      expect(sendButton().className).not.toMatch(/#[0-9a-f]{3,6}/i);
    },
  );
});

describe("the surrounding row", () => {
  /** The dropdown is gone and stays gone. */
  it("adds no action menu", async () => {
    respondWith(requestMock, { trips: buildPage([buildTrip()]) });
    renderRitten();

    await waitFor(() => expect(sendButton()).toBeEnabled());
    expect(screen.queryByRole("button", { name: /Acties/i })).not.toBeInTheDocument();
  });

  it("sits beside the lifecycle actions", async () => {
    respondWith(requestMock, { trips: buildPage([buildTrip()]) });
    renderRitten();

    await waitFor(() => expect(sendButton()).toBeEnabled());
    const cell = sendButton().closest("td") as HTMLElement;

    expect(
      within(cell).getByRole("button", { name: /Afwerken/i }),
    ).toBeInTheDocument();
    expect(
      within(cell).getByRole("button", { name: /Verwijderen/i }),
    ).toBeInTheDocument();
  });

  /** Sending writes nothing, so the list must not be refetched afterwards. */
  it("does not reload the list after a send", async () => {
    respondWith(requestMock, { trips: buildPage([buildTrip()]) });
    renderRitten();
    await waitFor(() => expect(sendButton()).toBeEnabled());
    const listCallsBefore = requestMock.mock.calls.filter(
      ([path]) => path === "/api/v1/trips",
    ).length;

    await userEvent.click(sendButton());
    await waitFor(() => expect(sendCalls()).toHaveLength(1));

    expect(
      requestMock.mock.calls.filter(([path]) => path === "/api/v1/trips"),
    ).toHaveLength(listCallsBefore);
  });
});
