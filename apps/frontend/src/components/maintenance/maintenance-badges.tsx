"use client";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import type {
  MaintenanceStatus,
  MaintenanceUrgency,
  MaintenanceUrgencyLevel,
} from "@/lib/api/maintenance";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { TranslationKey } from "@/lib/i18n/translations";

/**
 * The two labels a maintenance record wears: its status, and — while it is
 * planned — how pressing it is today.
 *
 * The urgency is the backend's answer, rendered as it came. TE LAAT is the
 * danger tone, the heaviest the design system has; VANDAAG the warning tone.
 */

const STATUS_TONES: Record<MaintenanceStatus, BadgeTone> = {
  PLANNED: "info",
  IN_PROGRESS: "warning",
  COMPLETED: "success",
  CANCELLED: "neutral",
};

const URGENCY_TONES: Record<MaintenanceUrgencyLevel, BadgeTone> = {
  OVERDUE: "danger",
  TODAY: "warning",
  UPCOMING: "info",
};

export function maintenanceStatusLabelKey(
  status: MaintenanceStatus,
): TranslationKey {
  return `maintenance.status.${status}` as TranslationKey;
}

export function MaintenanceStatusBadge({ status }: { status: MaintenanceStatus }) {
  const t = useTranslation();

  return (
    <Badge tone={STATUS_TONES[status]}>{t(maintenanceStatusLabelKey(status))}</Badge>
  );
}

/** "TE LAAT — 4 dagen", "TE LAAT — 1 dag", "VANDAAG" or "GEPLAND". */
export function urgencyLabel(
  urgency: MaintenanceUrgency,
  t: (key: TranslationKey) => string,
): string {
  if (urgency.level === "OVERDUE") {
    return urgency.daysOverdue === 1
      ? t("maintenance.urgency.overdueOne")
      : t("maintenance.urgency.overdue").replace(
          "{days}",
          String(urgency.daysOverdue),
        );
  }

  return urgency.level === "TODAY"
    ? t("maintenance.urgency.today")
    : t("maintenance.urgency.upcoming");
}

export function MaintenanceUrgencyBadge({
  urgency,
}: {
  urgency: MaintenanceUrgency;
}) {
  const t = useTranslation();

  return (
    <Badge tone={URGENCY_TONES[urgency.level]} className="font-semibold">
      {urgencyLabel(urgency, t)}
    </Badge>
  );
}
