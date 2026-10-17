import { Prisma, Trip, TripStatus } from "@prisma/client";
import { normalizeContainerNumber } from "@tms/parser";

import type { InvoiceSheetRow } from "../workbook/invoice-sheet";

/**
 * A transport line as the reader produces it, for the matching and combination
 * suites. The values are week 41's own.
 */
export function sheetRow(overrides: Partial<InvoiceSheetRow> = {}): InvoiceSheetRow {
  const containerNumber = overrides.containerNumber ?? "EUCU 4541197";

  return {
    rowNumber: 5,
    planningDate: "2026-10-05",
    bookingNumber: "ANRDUB2810849",
    containerNumber,
    normalizedContainerNumber: normalizeContainerNumber(containerNumber) ?? "",
    startPoint: "RELEASE BEQ869",
    endPoint: "VOYAGE BEQ869",
    remarks: "tar",
    costLine: null,
    amounts: {},
    ...overrides,
  };
}

/** A Trip as the database holds it — only what the invoice check reads. */
export function tripRecord(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "trip-1",
    status: TripStatus.CLOSED,
    isPaid: false,
    planningDate: new Date("2026-10-05T00:00:00.000Z"),
    originalPlanningDate: new Date("2026-10-05T00:00:00.000Z"),
    bookingNumber: "ANRDUB2810849",
    containerNumber: "EUCU4541197",
    tripGroupId: null,
    direction: "COLLECTION",
    terminal: "Quay 869",
    destinationCity: "SINT-AMANDSBERG",
    distanceKm: new Prisma.Decimal("49"),
    ...overrides,
  } as Trip;
}
