import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError, request } from "@/lib/api/client";
import {
  applyInvoiceAudit,
  type AppliedInvoiceAudit,
} from "@/lib/api/invoice-audit";
import { downloadBlob } from "@/lib/download";
import { LanguageProvider } from "@/lib/i18n/language-provider";
import { ThemeProvider } from "@/lib/theme/theme-provider";

import InvoiceAuditPage from "./page";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

/*
 * The final processing answers with BYTES rather than the envelope, so it has
 * its own client function — and the browser API that saves a file is the one
 * thing jsdom cannot do for real.
 */
jest.mock("@/lib/api/invoice-audit", () => ({
  ...jest.requireActual("@/lib/api/invoice-audit"),
  applyInvoiceAudit: jest.fn(),
}));

jest.mock("@/lib/download", () => ({ downloadBlob: jest.fn() }));

const applyMock = applyInvoiceAudit as jest.MockedFunction<
  typeof applyInvoiceAudit
>;
const downloadMock = downloadBlob as jest.MockedFunction<typeof downloadBlob>;

function applied(overrides: Record<string, unknown> = {}) {
  return {
    file: new Blob(["PK"]),
    fileName: "week 13 - 2026 GLT - gecorrigeerd.xlsx",
    paidTrips: 1,
    alreadyPaid: 0,
    rowsAdded: 1,
    rowsMarked: 3,
    correctedCells: 2,
    ...overrides,
  };
}

const requestMock = request as unknown as jest.MockedFunction<
  (path: string, options?: Record<string, unknown>) => Promise<unknown>
>;

/**
 * Excel factuurcontrole, as an operator uses it.
 *
 * ── WHAT THIS PAGE MAY AND MAY NOT DO ───────────────────────────────────────
 * It sends one workbook and shows what came back. It does not read the file,
 * does not compute a status of its own and does not write anything — so these
 * tests assert the request it makes, the answer it renders, and that a problem
 * row is visibly a problem.
 */

const CHECK_PATH = "/api/v1/invoice-audit/check";

function result(overrides: Record<string, unknown> = {}) {
  return {
    fileName: "week 13 - 2026 GLT.xlsx",
    sheetName: "Sheet1",
    period: { from: "2026-03-23", to: "2026-03-27" },
    summary: {
      totalRows: 4,
      matched: 1,
      notFound: 1,
      notFinished: 1,
      ambiguous: 1,
      priceChecked: 1,
      priceUnchanged: 0,
      priceCorrected: 1,
      priceNotDistributable: 0,
      correctedCells: 2,
      missingTrips: 1,
      addedMissing: 0,
    },
    rows: [
      {
        rowNumber: 2,
        status: "MATCHED",
        planningDate: "2026-03-23",
        bookingNumber: "DUBANR2718284",
        containerNumber: "EUCU 4581604",
        normalizedContainerNumber: "EUCU4581604",
        trip: {
          id: "3f1b0d2e-0000-4000-8000-000000000001",
          status: "CLOSED",
          planningDate: "2026-03-23",
          bookingNumber: "DUBANR2718284",
          containerNumber: "EUCU4581604",
        },
        candidates: [],
        sharedKeyRowNumbers: [],
        pricingStatus: "PRICING_CORRECTED",
        differences: [
          {
            component: "Tarief",
            column: "Tarief",
            invoiceValue: "364.00",
            expectedValue: "370.00",
            difference: "6.00",
            correctedValue: "370.00",
            correctionRowNumber: 2,
            keepsFormula: false,
            problem: null,
          },
          {
            component: "Backload",
            column: "Backload",
            invoiceValue: null,
            expectedValue: "50.00",
            difference: "50.00",
            correctedValue: "50.00",
            correctionRowNumber: 2,
            keepsFormula: false,
            problem: null,
          },
        ],
      },
      {
        rowNumber: 3,
        status: "NOT_FOUND",
        planningDate: "2026-03-24",
        bookingNumber: "ANRDUB2725107",
        containerNumber: "TLLU 1595717",
        normalizedContainerNumber: "TLLU1595717",
        trip: null,
        candidates: [],
        sharedKeyRowNumbers: [],
        pricingStatus: "NOT_COMPARED",
        differences: [],
      },
      {
        rowNumber: 4,
        status: "NOT_FINISHED",
        planningDate: "2026-03-25",
        bookingNumber: "ANRBEL2642387",
        containerNumber: "PVDU 1131710",
        normalizedContainerNumber: "PVDU1131710",
        trip: null,
        candidates: [
          {
            id: "3f1b0d2e-0000-4000-8000-000000000002",
            status: "OPEN",
            planningDate: "2026-03-25",
            bookingNumber: "ANRBEL2642387",
            containerNumber: "PVDU1131710",
          },
        ],
        sharedKeyRowNumbers: [],
        pricingStatus: "NOT_COMPARED",
        differences: [],
      },
      {
        rowNumber: 5,
        status: "AMBIGUOUS",
        planningDate: "2026-03-26",
        bookingNumber: "ANRCRK2643680",
        containerNumber: "EUCU 2451936",
        normalizedContainerNumber: "EUCU2451936",
        trip: null,
        candidates: [
          {
            id: "a",
            status: "CLOSED",
            planningDate: "2026-03-26",
            bookingNumber: "ANRCRK2643680",
            containerNumber: "EUCU2451936",
          },
          {
            id: "b",
            status: "CLOSED",
            planningDate: "2026-03-26",
            bookingNumber: "ANRCRK2643680",
            containerNumber: "EUCU2451936",
          },
        ],
        sharedKeyRowNumbers: [],
        pricingStatus: "NOT_COMPARED",
        differences: [],
      },
    ],
    incompleteRowNumbers: [],
    missingTrips: [
      {
        tripId: "9c0f0d2e-0000-4000-8000-000000000009",
        planningDate: "2026-03-23",
        bookingNumber: "BELANR2720016",
        containerNumber: "EUCU2451828",
        route: "Quay 869 -> MELSELE",
        tarief: "517.20",
        totaal: "681.08",
        rowNumber: 108,
      },
    ],
    ...overrides,
  };
}

function renderPage() {
  // Dutch, as the application defaults to and as these assertions read.
  window.localStorage.setItem("tms.language", "nl");

  return render(
    <ThemeProvider>
      <LanguageProvider>
        <InvoiceAuditPage />
      </LanguageProvider>
    </ThemeProvider>,
  );
}

function workbook(name = "week 13 - 2026 GLT.xlsx"): File {
  return new File(["PK"], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/** The hidden input the visible label opens. */
function fileInput(): HTMLInputElement {
  return document.getElementById("invoice-upload-input") as HTMLInputElement;
}

async function upload(
  file = workbook(),
  options: { applyAccept?: boolean } = {},
): Promise<void> {
  await userEvent.upload(fileInput(), file, options);
}

function rowFor(bookingNumber: string): HTMLElement {
  // A matched line prints the booking twice — its own cell, and the Trip it was
  // matched to — so the first occurrence, which is the cell, is the anchor.
  return screen.getAllByText(bookingNumber)[0].closest("tr") as HTMLElement;
}

describe("Excel factuurcontrole", () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockResolvedValue(result());
    applyMock.mockReset();
    applyMock.mockResolvedValue(applied());
    downloadMock.mockReset();
  });

  /** Uploads, checks, and waits for the answer to be on screen. */
  async function check(): Promise<void> {
    renderPage();
    await upload();
    await userEvent.click(screen.getByRole("button", { name: "Controleren" }));
    await screen.findAllByText("DUBANR2718284");
  }

  describe("before anything is checked", () => {
    it("says what the page will do and asks nothing of the server", () => {
      renderPage();

      expect(screen.getByText("Nog geen controle")).toBeInTheDocument();
      expect(requestMock).not.toHaveBeenCalled();
    });

    it("cannot be checked without a file", () => {
      renderPage();

      expect(
        screen.getByRole("button", { name: "Controleren" }),
      ).toBeDisabled();
    });
  });

  describe("checking a workbook", () => {
    it("sends the file to the check endpoint", async () => {
      renderPage();
      await upload();

      await userEvent.click(
        screen.getByRole("button", { name: "Controleren" }),
      );

      await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));

      const [path, options] = requestMock.mock.calls[0];
      expect(path).toBe(CHECK_PATH);
      expect(options?.method).toBe("POST");
      expect(options?.body).toBeInstanceOf(FormData);
      expect((options?.body as FormData).get("file")).toBeInstanceOf(File);
    });

    it("shows that it is working while the check runs", async () => {
      let finish: (value: unknown) => void = () => {};
      requestMock.mockReturnValue(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );

      renderPage();
      await upload();
      await userEvent.click(
        screen.getByRole("button", { name: "Controleren" }),
      );

      const busy = await screen.findByRole("button", {
        name: "Bezig met controleren…",
      });
      expect(busy).toBeDisabled();

      finish(result());
      await screen.findByText("week 13 - 2026 GLT.xlsx");
    });

    it("shows the counts and the period the file covers", async () => {
      renderPage();
      await upload();
      await userEvent.click(
        screen.getByRole("button", { name: "Controleren" }),
      );

      expect(
        await screen.findByText("23 maart 2026 - 27 maart 2026"),
      ).toBeInTheDocument();

      const summary = screen
        .getByText("Factuurregels")
        .closest("dl") as HTMLElement;
      expect(
        within(summary).getByText("Bestand").nextSibling,
      ).toHaveTextContent("week 13 - 2026 GLT.xlsx");
      expect(within(summary).getByText("4")).toBeInTheDocument();
    });

    it("shows one row per invoice line, with its Excel row number", async () => {
      renderPage();
      await upload();
      await userEvent.click(
        screen.getByRole("button", { name: "Controleren" }),
      );

      await screen.findAllByText("DUBANR2718284");

      expect(screen.getAllByRole("row")).toHaveLength(5); // the header and four lines
      expect(
        within(rowFor("DUBANR2718284")).getByText("2"),
      ).toBeInTheDocument();
      expect(
        within(rowFor("ANRCRK2643680")).getByText("5"),
      ).toBeInTheDocument();
    });

    it("links a matched line to the Trip it was matched to", async () => {
      renderPage();
      await upload();
      await userEvent.click(
        screen.getByRole("button", { name: "Controleren" }),
      );

      await screen.findAllByText("DUBANR2718284");

      const link = within(rowFor("DUBANR2718284")).getByRole("link");
      expect(link).toHaveAttribute(
        "href",
        "/trips/3f1b0d2e-0000-4000-8000-000000000001",
      );
      expect(link).toHaveTextContent("CLOSED");
    });
  });

  describe("the problem rows", () => {
    /**
     * The three answers an operator has to act on carry one highlight, and it
     * is the same set the corrected workbook will mark yellow later.
     */
    it.each([
      ["ANRDUB2725107", "Niet gevonden"],
      ["ANRBEL2642387", "Niet afgewerkt"],
      ["ANRCRK2643680", "Meerdere matches"],
    ])("marks %s as a problem", async (booking, label) => {
      renderPage();
      await upload();
      await userEvent.click(
        screen.getByRole("button", { name: "Controleren" }),
      );

      await screen.findByText(booking);

      const row = rowFor(booking);
      expect(within(row).getByText(label)).toBeInTheDocument();
      expect(row.className).toContain("bg-[#fdfd66]");
    });

    it("leaves a matched line unmarked", async () => {
      renderPage();
      await upload();
      await userEvent.click(
        screen.getByRole("button", { name: "Controleren" }),
      );

      await screen.findAllByText("DUBANR2718284");

      expect(rowFor("DUBANR2718284").className).not.toContain("bg-[#fdfd66]");
    });

    it("names the unfinished Trip rather than linking to nothing", async () => {
      renderPage();
      await upload();
      await userEvent.click(
        screen.getByRole("button", { name: "Controleren" }),
      );

      await screen.findByText("ANRBEL2642387");

      const row = rowFor("ANRBEL2642387");
      expect(within(row).queryByRole("link")).not.toBeInTheDocument();
      expect(row).toHaveTextContent("OPEN");
    });
  });

  describe("the pricing check", () => {
    it("says which lines were corrected and which were already right", async () => {
      renderPage();
      await upload();
      await userEvent.click(
        screen.getByRole("button", { name: "Controleren" }),
      );

      await screen.findAllByText("DUBANR2718284");

      const row = rowFor("DUBANR2718284");
      expect(within(row).getByText("Prijs aangepast")).toBeInTheDocument();
      expect(row).toHaveTextContent("Tarief: €364.00 → €370.00");
      expect(row).toHaveTextContent("Backload: €— → €50.00");
    });

    it("marks a line whose prices were already correct", async () => {
      requestMock.mockResolvedValue(
        result({
          rows: [
            {
              ...result().rows[0],
              pricingStatus: "MATCHED_NO_CHANGES",
              differences: [],
            },
          ],
        }),
      );

      renderPage();
      await upload();
      await userEvent.click(
        screen.getByRole("button", { name: "Controleren" }),
      );

      await screen.findAllByText("DUBANR2718284");

      expect(
        within(rowFor("DUBANR2718284")).getByText("Gecontroleerd"),
      ).toBeInTheDocument();
    });

    /** A difference the document gives no place to is shown, not written. */
    it("says when a difference could not be placed on a cell", async () => {
      requestMock.mockResolvedValue(
        result({
          rows: [
            {
              ...result().rows[0],
              pricingStatus: "NOT_DISTRIBUTABLE",
              differences: [
                {
                  component: "EK",
                  column: null,
                  invoiceValue: "200.00",
                  expectedValue: "250.00",
                  difference: "50.00",
                  correctedValue: null,
                  correctionRowNumber: 2,
                  keepsFormula: false,
                  problem: "EK is stated on 2 rows of this invoice",
                },
              ],
            },
          ],
        }),
      );

      renderPage();
      await upload();
      await userEvent.click(
        screen.getByRole("button", { name: "Controleren" }),
      );

      await screen.findAllByText("DUBANR2718284");

      const row = rowFor("DUBANR2718284");
      expect(
        within(row).getByText("Verschil niet toewijsbaar"),
      ).toBeInTheDocument();
      expect(row).toHaveTextContent("EK: €200.00 → €250.00");
      expect(row).toHaveTextContent(
        "staat op meerdere regels, niets gewijzigd",
      );
    });

    /** A line with no Trip is never compared, and shows no pricing verdict. */
    it.each(["ANRDUB2725107", "ANRBEL2642387", "ANRCRK2643680"])(
      "compares nothing for %s",
      async (booking) => {
        renderPage();
        await upload();
        await userEvent.click(
          screen.getByRole("button", { name: "Controleren" }),
        );

        await screen.findByText(booking);

        const row = rowFor(booking);
        expect(
          within(row).queryByText("Prijs aangepast"),
        ).not.toBeInTheDocument();
        expect(
          within(row).queryByText("Gecontroleerd"),
        ).not.toBeInTheDocument();
      },
    );

    it("counts the corrections in the summary", async () => {
      renderPage();
      await upload();
      await userEvent.click(
        screen.getByRole("button", { name: "Controleren" }),
      );

      await screen.findAllByText("DUBANR2718284");

      const summary = screen
        .getByText("Aangepaste cellen")
        .closest("dl") as HTMLElement;

      expect(
        within(summary).getByText("Aangepaste cellen").nextSibling,
      ).toHaveTextContent("2");
      expect(
        within(summary).getByText("Prijs aangepast").nextSibling,
      ).toHaveTextContent("1");
    });
  });

  describe("lines sharing one key", () => {
    it("shows both rows and says which rows share the key", async () => {
      requestMock.mockResolvedValue(
        result({
          summary: {
            totalRows: 2,
            matched: 2,
            notFound: 0,
            notFinished: 0,
            ambiguous: 0,
            priceChecked: 2,
            priceUnchanged: 2,
            priceCorrected: 0,
            priceNotDistributable: 0,
            correctedCells: 0,
            missingTrips: 0,
            addedMissing: 0,
          },
          rows: [
            {
              ...result().rows[0],
              rowNumber: 8,
              sharedKeyRowNumbers: [9],
              pricingStatus: "MATCHED_NO_CHANGES",
              differences: [],
            },
            {
              ...result().rows[0],
              rowNumber: 9,
              sharedKeyRowNumbers: [8],
              pricingStatus: "MATCHED_NO_CHANGES",
              differences: [],
            },
          ],
        }),
      );

      renderPage();
      await upload();
      await userEvent.click(
        screen.getByRole("button", { name: "Controleren" }),
      );

      await screen.findAllByText("DUBANR2718284");

      const rows = screen.getAllByRole("row").slice(1);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toHaveTextContent("zelfde sleutel als rij 9");
      expect(rows[1]).toHaveTextContent("zelfde sleutel als rij 8");
    });
  });

  /**
   * ── THE TRANSPORTS THE INVOICE FORGOT ─────────────────────────────────────
   * Finished, unpaid and not on the document. They are not problems and are not
   * highlighted: the corrected workbook adds them as ordinary lines, and the
   * screen says which row each one will take.
   */
  describe("missing finished transports", () => {
    it("lists them with the row the corrected file gives them", async () => {
      renderPage();
      await upload();
      await userEvent.click(
        screen.getByRole("button", { name: "Controleren" }),
      );

      await screen.findByText("Ontbrekende afgewerkte ritten:");

      const entry = screen
        .getByText("BELANR2720016")
        .closest("li") as HTMLElement;

      expect(entry).toHaveTextContent("Rij 108");
      expect(entry).toHaveTextContent("EUCU2451828");
      expect(entry).toHaveTextContent("2026-03-23");
      expect(entry).toHaveTextContent("Quay 869 -> MELSELE");
      expect(entry).toHaveTextContent("€681.08");
      expect(entry).toHaveTextContent("toegevoegd aan factuur");
    });

    it("links each of them to its Trip", async () => {
      renderPage();
      await upload();
      await userEvent.click(
        screen.getByRole("button", { name: "Controleren" }),
      );

      const link = await screen.findByRole("link", { name: "BELANR2720016" });

      expect(link).toHaveAttribute(
        "href",
        "/trips/9c0f0d2e-0000-4000-8000-000000000009",
      );
    });

    it("counts them in the summary", async () => {
      renderPage();
      await upload();
      await userEvent.click(
        screen.getByRole("button", { name: "Controleren" }),
      );

      const summary = screen
        .getByText("Ontbrekende ritten")
        .closest("dl") as HTMLElement;

      expect(
        within(summary).getByText("Ontbrekende ritten").nextSibling,
      ).toHaveTextContent("1");
    });

    it("says nothing at all when the invoice is complete", async () => {
      requestMock.mockResolvedValue(
        result({
          summary: { ...result().summary, missingTrips: 0 },
          missingTrips: [],
        }),
      );

      renderPage();
      await upload();
      await userEvent.click(
        screen.getByRole("button", { name: "Controleren" }),
      );

      await screen.findAllByText("DUBANR2718284");

      expect(
        screen.queryByText("Ontbrekende afgewerkte ritten:"),
      ).not.toBeInTheDocument();
    });
  });

  /**
   * ── THE FINAL STEP IS A DECISION ──────────────────────────────────────────
   * Checking changes nothing and may be repeated. Processing corrects the file,
   * adds what the invoice forgot and settles the transports it covers — so it
   * is a second, deliberate action, it says what it will do, and it cannot be
   * started twice.
   */
  describe("processing the invoice", () => {
    it("is not offered before anything has been checked", () => {
      renderPage();

      expect(
        screen.queryByRole("button", { name: "Verwerken en downloaden" }),
      ).not.toBeInTheDocument();
    });

    it("says how many transports it will settle", async () => {
      await check();

      expect(
        screen.getByText(/Ritten die op betaald gezet worden/),
      ).toHaveTextContent("Ritten die op betaald gezet worden: 1");
    });

    it("does nothing on its own: checking settles nothing", async () => {
      await check();

      expect(applyMock).not.toHaveBeenCalled();
    });

    it("sends the very file that was checked", async () => {
      await check();

      await userEvent.click(
        screen.getByRole("button", { name: "Verwerken en downloaden" }),
      );

      await waitFor(() => expect(applyMock).toHaveBeenCalledTimes(1));
      expect(applyMock.mock.calls[0][0]).toBeInstanceOf(File);
      expect(applyMock.mock.calls[0][0].name).toBe("week 13 - 2026 GLT.xlsx");
    });

    it("saves the corrected workbook under the name the server gave it", async () => {
      await check();

      await userEvent.click(
        screen.getByRole("button", { name: "Verwerken en downloaden" }),
      );

      await waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(1));
      expect(downloadMock.mock.calls[0][1]).toBe(
        "week 13 - 2026 GLT - gecorrigeerd.xlsx",
      );
    });

    it("cannot be started twice while it runs", async () => {
      let finish: (value: AppliedInvoiceAudit) => void = () => {};
      applyMock.mockReturnValue(
        new Promise<AppliedInvoiceAudit>((resolve) => {
          finish = resolve;
        }),
      );

      await check();
      await userEvent.click(
        screen.getByRole("button", { name: "Verwerken en downloaden" }),
      );

      const busy = await screen.findByRole("button", {
        name: "Bezig met verwerken…",
      });
      expect(busy).toBeDisabled();

      finish(applied());
      await screen.findByText("Excel verwerkt");
      expect(applyMock).toHaveBeenCalledTimes(1);
    });

    it("reports what the run did", async () => {
      await check();

      await userEvent.click(
        screen.getByRole("button", { name: "Verwerken en downloaden" }),
      );

      const panel = (await screen.findByText("Excel verwerkt"))
        .parentElement as HTMLElement;

      expect(panel).toHaveTextContent("week 13 - 2026 GLT - gecorrigeerd.xlsx");
      expect(
        within(panel).getByText("Op betaald gezet").nextSibling,
      ).toHaveTextContent("1");
      expect(
        within(panel).getByText("Prijsaanpassingen").nextSibling,
      ).toHaveTextContent("2");
      expect(
        within(panel).getByText("Ritten toegevoegd").nextSibling,
      ).toHaveTextContent("1");
      expect(
        within(panel).getByText("Probleemregels").nextSibling,
      ).toHaveTextContent("3");
    });

    it("shows the backend's reason when processing fails, and saves nothing", async () => {
      applyMock.mockRejectedValue(
        new ApiError("BAD_REQUEST", "De factuur kon niet verwerkt worden.", 400),
      );

      await check();
      await userEvent.click(
        screen.getByRole("button", { name: "Verwerken en downloaden" }),
      );

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "De factuur kon niet verwerkt worden.",
      );
      expect(downloadMock).not.toHaveBeenCalled();
      expect(screen.queryByText("Excel verwerkt")).not.toBeInTheDocument();
    });

    it("forgets what a previous run did when another file is checked", async () => {
      await check();
      await userEvent.click(
        screen.getByRole("button", { name: "Verwerken en downloaden" }),
      );
      await screen.findByText("Excel verwerkt");

      await upload(workbook("week 14 - 2026 GLT.xlsx"));

      expect(screen.queryByText("Excel verwerkt")).not.toBeInTheDocument();
    });
  });

  /**
   * ── A LINE THIS CHECK ADDED, SEEN AGAIN ───────────────────────────────────
   * On the next upload of the corrected document it is recognised, priced like
   * any other line, and never counted among the transports the run will settle.
   */
  describe("a line added by a previous run", () => {
    function withAddedLine() {
      return result({
        summary: { ...result().summary, addedMissing: 1 },
        rows: [
          {
            ...result().rows[0],
            rowNumber: 19,
            status: "ADDED_MISSING",
            bookingNumber: "BELANR2720016",
            containerNumber: "EUCU2451828",
            pricingStatus: "PRICING_CORRECTED",
            differences: [
              {
                component: "Tarief",
                column: "Tarief",
                invoiceValue: "517.20",
                expectedValue: "600.00",
                difference: "82.80",
                correctedValue: "600.00",
                correctionRowNumber: 19,
                keepsFormula: false,
                problem: null,
              },
            ],
          },
        ],
      });
    }

    it("says the line came from the check itself", async () => {
      requestMock.mockResolvedValue(withAddedLine());

      await check();

      const row = rowFor("BELANR2720016");

      expect(within(row).getByText("Door controle toegevoegd")).toBeInTheDocument();
      // Not a problem line: no highlight.
      expect(row.className).not.toContain("bg-[#fdfd66]");
    });

    it("still shows what its prices did", async () => {
      requestMock.mockResolvedValue(withAddedLine());

      await check();

      expect(rowFor("BELANR2720016")).toHaveTextContent(
        "Tarief: €517.20 → €600.00",
      );
    });

    it("is not counted among the transports that will be settled", async () => {
      requestMock.mockResolvedValue(withAddedLine());

      await check();

      expect(
        screen.getByText(/Ritten die op betaald gezet worden/),
      ).toHaveTextContent("Ritten die op betaald gezet worden: 0");
    });
  });

  describe("when the workbook is refused", () => {
    it("shows the backend's own reason", async () => {
      requestMock.mockRejectedValue(
        new ApiError(
          "BAD_REQUEST",
          "The invoice workbook does not have the expected structure, so nothing was checked.",
          400,
          ["missing column: Tol B"],
        ),
      );

      renderPage();
      await upload();
      await userEvent.click(
        screen.getByRole("button", { name: "Controleren" }),
      );

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(/does not have the expected structure/);
      // And no half-rendered result beside it.
      expect(screen.getByText("Nog geen controle")).toBeInTheDocument();
    });

    it("refuses a file that is not an .xlsx before sending it", async () => {
      renderPage();

      await upload(
        new File(["%PDF"], "order.pdf", { type: "application/pdf" }),
        {
          applyAccept: false,
        },
      );

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Alleen .xlsx-bestanden",
      );
      expect(requestMock).not.toHaveBeenCalled();
    });
  });

  describe("choosing another file", () => {
    it("drops the previous answer, which is about another document", async () => {
      renderPage();
      await upload();
      await userEvent.click(
        screen.getByRole("button", { name: "Controleren" }),
      );

      await screen.findAllByText("DUBANR2718284");

      await upload(workbook("week 14 - 2026 GLT.xlsx"));

      expect(screen.queryByText("DUBANR2718284")).not.toBeInTheDocument();
      expect(screen.getByText("Nog geen controle")).toBeInTheDocument();
    });
  });
});
