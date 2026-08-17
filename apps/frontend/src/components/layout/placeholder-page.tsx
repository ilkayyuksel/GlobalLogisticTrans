"use client";

import { Card, CardBody } from "@/components/ui/card";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { TranslationKey } from "@/lib/i18n/translations";

/**
 * A route that exists so the navigation is complete, before its feature is.
 *
 * It says so plainly. A page that looked finished but did nothing would be
 * worse than an empty one: an operator would report it as broken, and a
 * developer would have to rediscover that it was never built.
 */
export function PlaceholderPage({ titleKey }: { titleKey: TranslationKey }) {
  const t = useTranslation();

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-4 text-xl font-semibold text-foreground">
        {t(titleKey)}
      </h1>

      <Card>
        <CardBody>
          <p className="text-sm font-medium text-foreground">
            {t("placeholder.notBuiltYet")}
          </p>
          <p className="mt-1 max-w-2xl text-sm text-secondary">
            {t("placeholder.description")}
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
