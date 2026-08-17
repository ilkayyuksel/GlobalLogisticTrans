import type { UpdateTripPayload } from "@/lib/api/trips";
import type { ChangeableTripStatus, Trip } from "@/lib/api/types";
import type { TranslationKey } from "@/lib/i18n/translations";

/**
 * What a Ritten row can ask the page to do.
 *
 * One object rather than nine props: every one of these ends in the same place
 * — a backend call followed by a refetch of the authoritative data — and the
 * page owns that sequence. A row never mutates anything itself, and never
 * decides that something succeeded.
 */
export interface RittenActions {
  /** Resolves when the backend accepted the change AND the list was refetched. */
  saveTrip: (tripId: string, payload: UpdateTripPayload) => Promise<void>;
  changeStatus: (trip: Trip, status: ChangeableTripStatus) => Promise<void>;
  deleteTrip: (trip: Trip) => Promise<void>;
  restoreTrip: (trip: Trip) => Promise<void>;
  reprocessPricing: (trip: Trip) => Promise<void>;
  openCombination: (tripGroupId: string) => void;
  /** Clears this Trip's group; the group and its other members survive. */
  unlinkFromGroup: (trip: Trip) => Promise<void>;
  openPdf: (trip: Trip) => void;
  downloadPdf: (trip: Trip) => Promise<void>;
  openCustomProperties: (trip: Trip) => void;
  openDetails: (trip: Trip) => void;
}

/** Translations for the transitions `statusActionsFor` offers. */
export const STATUS_LABEL_KEYS: Record<ChangeableTripStatus, TranslationKey> = {
  CLOSED: "ritten.menu.close",
  CANCELLED: "ritten.menu.cancel",
  OPEN: "ritten.menu.reopen",
};

/**
 * Confirmations, where the consequence is not obviously reversible.
 *
 * Reopening needs none: it is the undo of cancelling.
 */
export const STATUS_CONFIRM_KEYS: Partial<
  Record<ChangeableTripStatus, TranslationKey>
> = {
  CLOSED: "ritten.confirm.close",
  CANCELLED: "ritten.confirm.cancel",
};

/**
 * Reprocessing exists to recover a CLOSED Trip whose pricing is missing or
 * stale. It is meaningless before a Trip is closed, because pricing only runs
 * at closing.
 */
export function canReprocess(trip: Trip): boolean {
  return trip.status === "CLOSED";
}

/** A DELETED Trip is read-only until it is restored. */
export function canEdit(trip: Trip): boolean {
  return trip.status !== "DELETED";
}

/**
 * Every Trip has exactly one source document, so viewing it is always offered.
 *
 * The column is non-nullable in the database: a Trip cannot exist without the
 * PDF it came from.
 */
export function canViewPdf(trip: Trip): boolean {
  return Boolean(trip.pdfDocumentId);
}
