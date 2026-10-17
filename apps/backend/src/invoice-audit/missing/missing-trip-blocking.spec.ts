import { sheetRow, tripRecord } from "../__fixtures__/invoice-rows";
import { InvoiceRowStatus, type InvoiceRowMatch } from "../matching/invoice-row-match";
import { blockingRowsFor, toBlockingIdentities } from "./missing-trip-blocking";

function line(rowNumber: number, status: InvoiceRowStatus, booking: string, container: string): InvoiceRowMatch {
  return {
    row: sheetRow({ rowNumber, bookingNumber: booking, containerNumber: container }),
    status,
    trip: null,
    candidates: [],
    sharedKeyRowNumbers: [],
    containerCorrection: null,
    bookingCorrection: null,
    costConfirmation: null,
    combination: null,
    problem: null,
  };
}

describe("missing transports and the lines that could be them", () => {
  const missing = tripRecord({ bookingNumber: "ANRDUB2810849", containerNumber: "EUCU4541197" });

  it("blocks a transport whose booking an unresolved line states — a misprinted date", () => {
    const identities = toBlockingIdentities(
      [line(5, InvoiceRowStatus.NOT_FOUND, "ANRDUB2810849", "EUCU 4541197")],
      [],
    );

    expect(blockingRowsFor(missing, identities)).toEqual([5]);
  });

  it("blocks a transport whose container an unresolved line states — a misprinted booking", () => {
    const identities = toBlockingIdentities(
      [line(5, InvoiceRowStatus.NOT_FOUND, "ANRDUB2810000", "EUCU 4541197")],
      [],
    );

    expect(blockingRowsFor(missing, identities)).toEqual([5]);
  });

  it.each([InvoiceRowStatus.AMBIGUOUS, InvoiceRowStatus.CONFLICT, InvoiceRowStatus.COST_LINE_UNRESOLVED])(
    "is blocked by a %s line too",
    (status) => {
      const identities = toBlockingIdentities([line(9, status, "ANRDUB2810849", "")], []);

      expect(blockingRowsFor(missing, identities)).toEqual([9]);
    },
  );

  it("is blocked by an incomplete row naming its booking", () => {
    const identities = toBlockingIdentities(
      [],
      [{ rowNumber: 53, bookingNumber: "ANRDUB2810849", normalizedContainerNumber: null }],
    );

    expect(blockingRowsFor(missing, identities)).toEqual([53]);
  });

  /** Week 41 invoices four containers under ANRDUB2814746. */
  it("is not blocked by lines that were resolved to other Trips", () => {
    const identities = toBlockingIdentities(
      [
        line(64, InvoiceRowStatus.MATCHED, "ANRDUB2814746", "AGLU 0400410"),
        line(65, InvoiceRowStatus.MATCHED, "ANRDUB2814746", "AGLU 0400071"),
      ],
      [],
    );

    expect(
      blockingRowsFor(tripRecord({ bookingNumber: "ANRDUB2814746", containerNumber: "AGLU0400999" }), identities),
    ).toEqual([]);
  });
});
