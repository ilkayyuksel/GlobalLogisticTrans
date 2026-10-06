import { request } from "./client";

/**
 * What an export prints about one Trip, beside its amounts — composed by the
 * backend, which owns this vocabulary.
 *
 * The browser places these words in cells and never assembles them: the
 * invoice check writes the same Trips into the customer's workbook from the
 * server, and both must say exactly the same thing.
 */
export interface TripExportLabels {
  /** The Remarks column: properties, TAR, the waiting window, every CC. */
  readonly remarks: string;
  /** `Wachttijd 07:00-10:00`, or the duration, or null when none was recorded. */
  readonly waitingLabel: string | null;
  /** Whether the Engine charged TAR, read from the stored snapshot. */
  readonly tarCharged: boolean;
}

/** What a Trip with no labels says: nothing. */
export const NO_LABELS: TripExportLabels = {
  remarks: "",
  waitingLabel: null,
  tarCharged: false,
};

const LABELS_PATH = "/api/v1/trip-export/labels";

/** The largest number of Trips one labels request may ask about. */
const MAX_LABEL_TRIP_IDS = 100;

/**
 * The export words of many Trips, in batches of a hundred — the same batching
 * the snapshots read beside it uses, for the same reason.
 *
 * The words are the operator's own — for waiting time, and for a window that
 * ends the next day: translation is the browser's, and the server only places
 * the words it is given.
 */
export interface TripExportLabelWords {
  readonly waitingWord: string;
  readonly nextDayWord: string;
}

export async function fetchTripExportLabels(
  tripIds: readonly string[],
  { waitingWord, nextDayWord }: TripExportLabelWords,
  signal?: AbortSignal,
): Promise<Map<string, TripExportLabels>> {
  const byTripId = new Map<string, TripExportLabels>();

  for (let start = 0; start < tripIds.length; start += MAX_LABEL_TRIP_IDS) {
    const batch = tripIds.slice(start, start + MAX_LABEL_TRIP_IDS);

    const labels = await request<(TripExportLabels & { tripId: string })[]>(
      LABELS_PATH,
      {
        query: { tripIds: batch.join(","), waitingWord, nextDayWord },
        signal,
      },
    );

    for (const { tripId, ...label } of labels) {
      byTripId.set(tripId, label);
    }
  }

  return byTripId;
}
