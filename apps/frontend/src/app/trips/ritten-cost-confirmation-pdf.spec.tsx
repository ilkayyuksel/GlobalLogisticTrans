import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  buildPage,
  buildTrip,
  renderRitten,
  respondWith,
} from "./ritten-test-support";
import { request } from "@/lib/api/client";
import type { Trip } from "@/lib/api/types";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

const requestMock = request as jest.MockedFunction<typeof request>;

/** Built from NEXT_PUBLIC_API_URL, which jest.setup.ts fixes for the suite. */
const CONTENT = (id: string) =>
  `http://backend.test/api/v1/pdf-documents/${id}/content`;

/**
 * Opening the Cost Confirmation's own document from the Ritten list.
 *
 * ── IT IS A DIFFERENT DOCUMENT ──────────────────────────────────────────────
 * A Trip's `pdfDocumentId` is the transport order it was imported from — the
 * NEW, and later the UPDATE or CANCEL that revised it. The confirmation is a
 * separate document that arrived from Eucon afterwards, with its own id on the
 * CostConfirmation record.
 *
 * These tests exist because the two are easy to confuse and the mistake is
 * invisible: both open a viewer, both show a PDF, and only the content differs.
 * So every assertion below names the id that was actually fetched.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Nothing extra is requested to make the button work: the confirmation travels
 * on the Trip the list endpoint already returned, id included.
 */

const ORDER_PDF = "pdf-order-1";
const UPDATE_PDF = "pdf-update-1";
const CANCEL_PDF = "pdf-cancel-1";
const CONFIRMATION_PDF = "pdf-cc-1";

const CONFIRMED: Trip = buildTrip({
  pdfDocumentId: ORDER_PDF,
  costConfirmation: {
    id: "cc-1",
    ccNumber: "4139505",
    costCode: "WAIT",
    amount: "27.50",
    currency: "EUR",
    receivedAt: "2026-08-18T09:00:00.000Z",
    pdfDocumentId: CONFIRMATION_PDF,
  },
  /*
   * A Trip that has ALSO been revised: its latest update names another
   * document again. None of these may be what the CC button opens.
   */
  latestUpdate: {
    occurredAt: "2026-08-19T09:00:00.000Z",
    changedFields: ["terminal"],
    pdfDocumentId: UPDATE_PDF,
  },
});

const UNCONFIRMED: Trip = buildTrip({
  pdfDocumentId: ORDER_PDF,
  costConfirmation: null,
});

describe("the Cost Confirmation document in Ritten", () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    requestMock.mockReset();
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");

    fetchMock = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        blob: () =>
          Promise.resolve(new Blob(["%PDF-1.7"], { type: "application/pdf" })),
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    Object.defineProperty(URL, "createObjectURL", {
      value: jest.fn(() => "blob:traxo-pdf"),
      writable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: jest.fn(),
      writable: true,
    });
  });

  async function show(trip: Trip): Promise<void> {
    respondWith(requestMock, { trips: buildPage([trip]) });
    renderRitten();
    await screen.findByRole("table");
  }

  /** Every URL the viewer actually asked the backend for. */
  function fetchedUrls(): string[] {
    return fetchMock.mock.calls.map(([url]) => String(url));
  }

  function ccButton(label = "Kostenbevestiging-PDF bekijken CC4139505") {
    return screen.queryByRole("button", { name: label });
  }

  describe("when the Trip has one", () => {
    it("shows the number and the amount", async () => {
      await show(CONFIRMED);

      const cell = (await screen.findByText("CC4139505")).closest(
        "td",
      ) as HTMLElement;

      expect(within(cell).getByText("27.50")).toBeInTheDocument();
    });

    it("offers a button beside them", async () => {
      await show(CONFIRMED);

      const cell = (await screen.findByText("CC4139505")).closest(
        "td",
      ) as HTMLElement;

      expect(
        within(cell).getByRole("button", {
          name: "Kostenbevestiging-PDF bekijken CC4139505",
        }),
      ).toBeEnabled();
    });

    it("opens the viewer", async () => {
      await show(CONFIRMED);

      await userEvent.click(ccButton() as HTMLElement);

      const dialog = await screen.findByRole("dialog");

      expect(await within(dialog).findByTitle("PDF-weergave")).toHaveAttribute(
        "src",
        "blob:traxo-pdf",
      );
    });

    /** The confirmation names itself, so the operator sees which one opened. */
    it("names the confirmation in the viewer", async () => {
      await show(CONFIRMED);

      await userEvent.click(ccButton() as HTMLElement);
      const dialog = await screen.findByRole("dialog");

      expect(within(dialog).getByText(/CC4139505/)).toBeInTheDocument();
    });
  });

  /**
   * The whole point: the id it resolves. `CostConfirmation.pdfDocumentId`, and
   * never the Trip's own document — which is the transport order.
   */
  describe("which document it opens", () => {
    it("fetches the confirmation's own document", async () => {
      await show(CONFIRMED);

      await userEvent.click(ccButton() as HTMLElement);

      await waitFor(() => {
        expect(fetchedUrls()).toContain(CONTENT(CONFIRMATION_PDF));
      });
    });

    it("never fetches the Trip's original NEW document", async () => {
      await show(CONFIRMED);

      await userEvent.click(ccButton() as HTMLElement);

      await waitFor(() => expect(fetchedUrls()).not.toHaveLength(0));
      expect(fetchedUrls()).not.toContain(CONTENT(ORDER_PDF));
    });

    it("never fetches an UPDATE document", async () => {
      await show(CONFIRMED);

      await userEvent.click(ccButton() as HTMLElement);

      await waitFor(() => expect(fetchedUrls()).not.toHaveLength(0));
      expect(fetchedUrls()).not.toContain(CONTENT(UPDATE_PDF));
    });

    it("never fetches a CANCEL document", async () => {
      await show(CONFIRMED);

      await userEvent.click(ccButton() as HTMLElement);

      await waitFor(() => expect(fetchedUrls()).not.toHaveLength(0));
      expect(fetchedUrls()).not.toContain(CONTENT(CANCEL_PDF));
    });

    it("asks for exactly one document", async () => {
      await show(CONFIRMED);

      await userEvent.click(ccButton() as HTMLElement);

      await waitFor(() => expect(fetchedUrls()).toHaveLength(1));
    });

    /** And the transport-order button still opens the transport order. */
    it("leaves the transport-order button pointing at the order", async () => {
      await show(CONFIRMED);

      await userEvent.click(
        screen.getByRole("button", { name: "PDF bekijken ANRDUB2602247" }),
      );

      await waitFor(() => {
        expect(fetchedUrls()).toContain(CONTENT(ORDER_PDF));
      });
      expect(fetchedUrls()).not.toContain(CONTENT(CONFIRMATION_PDF));
    });
  });

  /**
   * Nothing confirmed and confirmed at nothing are different facts. A Trip with
   * no confirmation shows the ordinary empty marker — never a zero, never an
   * "N/A", and never a button pointing at a document that does not exist.
   */
  describe("when the Trip has none", () => {
    it("shows no button", async () => {
      await show(UNCONFIRMED);

      expect(ccButton()).toBeNull();
      expect(
        screen.queryByRole("button", { name: /Kostenbevestiging/ }),
      ).toBeNull();
    });

    it("shows no disabled icon either", async () => {
      await show(UNCONFIRMED);

      const row = screen.getByRole("row", { name: /ANRDUB2602247/ });

      for (const button of within(row).getAllByRole("button")) {
        expect(button).not.toHaveAccessibleName(/Kostenbevestiging/);
      }
    });

    it("keeps the ordinary empty marker", async () => {
      await show(UNCONFIRMED);

      const row = screen.getByRole("row", { name: /ANRDUB2602247/ });

      expect(within(row).getAllByText("—").length).toBeGreaterThan(0);
      expect(within(row).queryByText("0.00")).toBeNull();
      expect(within(row).queryByText(/N\/A/)).toBeNull();
    });
  });

  /**
   * The confirmation is operational, not a margin: an operator checks it while
   * working the list. It does not follow the pricing toggle.
   */
  describe("with prices hidden", () => {
    it("still shows the confirmation and its button", async () => {
      await show(CONFIRMED);

      expect(
        screen.queryByRole("columnheader", { name: "Tarief" }),
      ).not.toBeInTheDocument();
      expect(screen.getByText("CC4139505")).toBeInTheDocument();
      expect(ccButton()).toBeEnabled();
    });

    it("still opens the confirmation's own document", async () => {
      await show(CONFIRMED);

      await userEvent.click(ccButton() as HTMLElement);

      await waitFor(() => {
        expect(fetchedUrls()).toContain(CONTENT(CONFIRMATION_PDF));
      });
    });
  });

  /** Read-only: a viewer, and nothing that changes what Eucon confirmed. */
  it("offers nothing that edits the confirmation", async () => {
    await show(CONFIRMED);

    const cell = screen.getByText("CC4139505").closest("td") as HTMLElement;

    expect(within(cell).getAllByRole("button")).toHaveLength(1);
    expect(within(cell).queryByRole("textbox")).toBeNull();
    expect(within(cell).queryByRole("spinbutton")).toBeNull();
  });

  describe("presentation", () => {
    it("is translated", async () => {
      window.localStorage.setItem("tms.language", "tr");
      await show(CONFIRMED);

      expect(
        screen.getByRole("button", {
          name: "Maliyet Onayı PDF'sini görüntüle CC4139505",
        }),
      ).toBeInTheDocument();
    });

    it("opens the same document in Turkish", async () => {
      window.localStorage.setItem("tms.language", "tr");
      await show(CONFIRMED);

      await userEvent.click(
        ccButton("Maliyet Onayı PDF'sini görüntüle CC4139505") as HTMLElement,
      );

      await waitFor(() => {
        expect(fetchedUrls()).toContain(CONTENT(CONFIRMATION_PDF));
      });
    });

    it.each(["light", "dark"])(
      "uses design tokens in %s mode",
      async (theme) => {
        document.documentElement.classList.toggle("dark", theme === "dark");
        await show(CONFIRMED);

        const button = ccButton() as HTMLElement;

        expect(button.className).toMatch(/text-secondary/);
        expect(button.className).not.toMatch(/#[0-9a-f]{3,8}/i);
        expect(button.innerHTML).not.toMatch(/#[0-9a-f]{3,8}/i);
      },
    );

    /** The icon alone is not a label; a screen reader must hear what it opens. */
    it("names what the button opens", async () => {
      await show(CONFIRMED);

      expect(ccButton()).toHaveAccessibleName(
        "Kostenbevestiging-PDF bekijken CC4139505",
      );
    });
  });
});
