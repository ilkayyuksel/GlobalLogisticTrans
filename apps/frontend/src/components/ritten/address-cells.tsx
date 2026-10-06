"use client";

import type { UpdateTripPayload } from "@/lib/api/trips";
import type { Trip } from "@/lib/api/types";
import { useTranslation } from "@/lib/i18n/language-provider";
import { canEdit } from "@/lib/ritten/row-actions";

import { InlineCell } from "./inline-cell";

/**
 * The two ends of a Trip in the Ritten list: its terminal and its destination.
 *
 * ── EDITABLE ON EVERY TRIP ──────────────────────────────────────────────────
 * The business decided an operator must be able to correct where a Trip starts
 * and where it goes, imported or not. On an imported Trip a later UPDATE of the
 * same order writes the address it states again — the ordinary revision
 * behaviour, accepted knowingly. A DELETED Trip stays read-only.
 *
 * Both ends are pricing inputs (RoutePricing and route costs match on them), so
 * the BACKEND reprices a CLOSED Trip after the edit and answers with the new
 * amounts. Nothing here decides anything about money.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** TERMINAL_MAX_LENGTH in the backend's create-trip.dto.ts. */
const TERMINAL_MAX_LENGTH = 200;
/** City and country are 200 each there; this field carries both with a comma. */
const DESTINATION_FIELD_MAX_LENGTH = 401;

interface AddressCellProps {
  trip: Trip;
  isBusy: boolean;
  onSave: (payload: UpdateTripPayload) => Promise<void>;
}

/** Where the Trip starts or ends at the quay. */
export function TerminalCell({ trip, isBusy, onSave }: AddressCellProps) {
  const t = useTranslation();
  const display = trip.terminal ?? t("ritten.value.empty");

  if (!canEdit(trip)) {
    return <>{display}</>;
  }

  return (
    <InlineCell
      label={t("ritten.edit.terminal")}
      displayValue={display}
      editValue={trip.terminal ?? ""}
      maxLength={TERMINAL_MAX_LENGTH}
      isDisabled={isBusy}
      // Emptied means "no terminal", which the backend spells null.
      onSave={(value) =>
        onSave({ terminal: value.trim() === "" ? null : value.trim() })
      }
    />
  );
}

/**
 * Where the Trip is going.
 *
 * City and country are one address and are edited as one field: moving a Trip
 * from Bousbecque to Venlo without its country would leave the two disagreeing.
 * "City, Country" is the same text the column already showed.
 */
export function DestinationCell({ trip, isBusy, onSave }: AddressCellProps) {
  const t = useTranslation();
  const parts = [trip.destinationCity, trip.destinationCountry].filter(
    (part): part is string => Boolean(part),
  );
  const display = parts.length > 0 ? parts.join(", ") : t("ritten.value.empty");

  if (!canEdit(trip)) {
    return <>{display}</>;
  }

  return (
    <InlineCell
      label={t("ritten.edit.destination")}
      displayValue={display}
      editValue={parts.join(", ")}
      maxLength={DESTINATION_FIELD_MAX_LENGTH}
      isDisabled={isBusy}
      onSave={(value) => onSave(toDestination(value))}
    />
  );
}

/**
 * Splits "Venlo, Netherlands" into the two columns the backend stores.
 *
 * Only the FIRST comma separates them: a city may contain one — "Saint Laurent
 * Blangy, Pas-de-Calais, France" is a city and a country, not three fields —
 * so everything after the first comma is the country. Text with no comma is a
 * city alone, and the country is cleared rather than left behind pointing at a
 * place the Trip no longer goes to.
 */
export function toDestination(value: string): UpdateTripPayload {
  const separator = value.indexOf(",");

  if (separator === -1) {
    const city = value.trim();

    return {
      destinationCity: city === "" ? null : city,
      destinationCountry: null,
    };
  }

  const city = value.slice(0, separator).trim();
  const country = value.slice(separator + 1).trim();

  return {
    destinationCity: city === "" ? null : city,
    destinationCountry: country === "" ? null : country,
  };
}
