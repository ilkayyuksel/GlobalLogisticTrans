import { Badge, type BadgeTone } from "@/components/ui/badge";
import type { TripStatus } from "@/lib/api/types";

/**
 * A Trip's status, coloured per `docs/03-ui/design_tokens.md`.
 *
 * The mapping is exhaustive over the status enum, so adding a status to the
 * backend without deciding how it looks here becomes a compile error rather
 * than an unstyled label discovered in production.
 */
const TONE_BY_STATUS: Record<TripStatus, BadgeTone> = {
  OPEN: "info",
  CLOSED: "success",
  CANCELLED: "danger",
  DELETED: "neutral",
};

/**
 * `label` lets a translated screen show "Afgewerkt" where an untranslated one
 * still shows the raw status. The colour stays the responsibility of this
 * component either way, so no caller reimplements the mapping.
 */
export function TripStatusBadge({
  status,
  label,
}: {
  status: TripStatus;
  label?: string;
}) {
  return <Badge tone={TONE_BY_STATUS[status]}>{label ?? status}</Badge>;
}
