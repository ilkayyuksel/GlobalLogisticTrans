"use client";

import Link from "next/link";

import { useTranslation } from "@/lib/i18n/language-provider";
import type { TranslationKey } from "@/lib/i18n/translations";

/** The "→" link at the foot of a widget. */
export function WidgetLink({
  href,
  labelKey,
}: {
  href: string;
  labelKey: TranslationKey;
}) {
  const t = useTranslation();

  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
    >
      {t(labelKey)}
      <span aria-hidden="true">→</span>
    </Link>
  );
}
