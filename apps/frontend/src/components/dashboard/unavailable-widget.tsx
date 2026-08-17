"use client";

import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { WidgetLink } from "./widget-link";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { TranslationKey } from "@/lib/i18n/translations";

/**
 * A widget whose data the backend does not expose yet.
 *
 * It says so. The alternative — plausible sample numbers — would be read as
 * real by the first operator who saw them, and maintenance warnings in
 * particular are exactly the kind of invented figure that gets acted on.
 */
export function UnavailableWidget({
  titleKey,
  linkHref,
  linkLabelKey,
}: {
  titleKey: TranslationKey;
  linkHref: string;
  linkLabelKey: TranslationKey;
}) {
  const t = useTranslation();

  return (
    <Card>
      <CardHeader title={t(titleKey)} />
      <CardBody>
        <p className="text-sm font-medium text-foreground">
          {t("dashboard.notAvailable")}
        </p>
        <p className="mt-1 text-sm text-secondary">
          {t("dashboard.needsBackend")}
        </p>
        <p className="mt-3">
          <WidgetLink href={linkHref} labelKey={linkLabelKey} />
        </p>
      </CardBody>
    </Card>
  );
}
