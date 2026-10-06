/**
 * Instants as the operator reads and types them: their LOCAL wall clock.
 *
 * ── THE CONVENTION ──────────────────────────────────────────────────────────
 * A moment such as "Uitgevoerd op" is stored as an INSTANT (timestamptz) and
 * travels as ISO UTC: `2026-10-01T22:00:00.000Z`. A person means a local clock
 * reading — midnight in Antwerp — and `<input type="datetime-local">` holds
 * exactly that, with no zone: `2026-10-02T00:00`.
 *
 * So there are two conversions and each happens ONCE, here:
 *
 *   instant → local  for showing and for filling the input
 *   local → instant  for sending what was typed
 *
 * Slicing the ISO string instead (`"…T22:00"`) shows the UTC clock as if it
 * were local, and reading that back as local moves the moment by the offset —
 * two hours earlier on every save in summer. That is the bug this replaces.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** `2026-10-02T00:00` for `2026-10-01T22:00:00.000Z` in Brussels; "" for none. */
export function toLocalDateTimeInput(instant: string | null): string {
  if (!instant) {
    return "";
  }

  const date = new Date(instant);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return `${toLocalDate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The instant a local `YYYY-MM-DDTHH:mm` stands for, as ISO UTC; null for none. */
export function fromLocalDateTimeInput(localValue: string): string | null {
  if (localValue.trim() === "") {
    return null;
  }

  // No zone in the text, so the browser reads it as LOCAL — which it is.
  return new Date(localValue).toISOString();
}

/** `2026-10-02 00:00`: the local clock reading of an instant, for display. */
export function formatLocalDateTime(instant: string | null): string | null {
  const local = toLocalDateTimeInput(instant);

  return local === "" ? null : local.replace("T", " ");
}

function toLocalDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
