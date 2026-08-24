import { TripCustomPropertyRepository } from "../trip-custom-properties/trip-custom-property.repository";
import { PdfDocumentRepository } from "../pdf-documents/pdf-document.repository";
import { TripRepository } from "./trip.repository";

/**
 * A stand-in for `TripRepository.runTripWriteTransaction`.
 *
 * Not a test file — a shared double, in the same spirit as
 * `real-documents.harness.ts`.
 *
 * The real method hands its callback three repositories bound to one
 * transaction. A dozen specs care about only one of them and would otherwise
 * each spell out the same three-line object, which is how a change to that
 * shape turns into a dozen edits.
 *
 * `trips` is the double the spec already has, passed straight through so every
 * call it makes stays observable. The other two default to inert stubs: a spec
 * that does not exercise documents or automatic properties should not have to
 * describe them, and one that does passes its own.
 */
export function stubTripWriteTransaction(
  trips: unknown,
  overrides: {
    pdfDocuments?: unknown;
    customProperties?: unknown;
  } = {},
): jest.Mock {
  return jest.fn((work: (repositories: unknown) => Promise<unknown>) =>
    work({
      trips: trips as TripRepository,
      pdfDocuments: (overrides.pdfDocuments ??
        emptyPdfDocuments()) as PdfDocumentRepository,
      customProperties: (overrides.customProperties ??
        emptyCustomProperties()) as TripCustomPropertyRepository,
    }),
  );
}

/** Answers "nothing is assigned", which is true of every Trip these specs build. */
function emptyCustomProperties() {
  return {
    create: jest.fn((data: Record<string, unknown>) =>
      Promise.resolve({ id: "trip-custom-property-1", ...data }),
    ),
    findByTripAndProperty: jest.fn().mockResolvedValue(null),
    findByTripId: jest.fn().mockResolvedValue([]),
    delete: jest.fn(),
  };
}

function emptyPdfDocuments() {
  return {
    create: jest.fn().mockResolvedValue({ id: "pdf-1" }),
  };
}
