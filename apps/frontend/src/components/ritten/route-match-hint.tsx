"use client";

import type { RouteMatch } from "@/lib/api/types";
import { useTranslation } from "@/lib/i18n/language-provider";
import {
  formatRoad,
  legsInOrder,
  routeMatchTone,
  type RouteMatchTone,
} from "@/lib/pricing/route-match-display";

/**
 * The route behind a Ritten row's Tarief, at a glance.
 *
 * A small marker beside the amount; its tooltip names the configured road(s)
 * the stored price came from and how they matched. Quiet for an ordinary match,
 * emphasised when the Tarief is zero because nothing reliable matched, or when
 * a typo was trusted. The full account is on the Trip's detail page.
 *
 * Beside a route that DID price the Trip, a second marker says that its price
 * has not been through the Routeprijzen page's check yet. The backend reads
 * that page's own mark for the very configuration the snapshot recorded — the
 * screen decides nothing — and a match that failed never carries one: that is
 * the first marker's warning, not a price to check.
 */
export function RouteMatchHint({ routeMatch }: { routeMatch: RouteMatch | null | undefined }) {
  const t = useTranslation();

  // A response without the record at all (an older backend): nothing to say.
  if (routeMatch === undefined || routeMatch === null) {
    return null;
  }

  const tone = routeMatchTone(routeMatch);
  const description = describe(routeMatch, tone, t);
  const needsReview = routeMatch.reviewed === false && PRICED_TONES.includes(tone);

  return (
    <>
      <span
        role="img"
        aria-label={`${t("ritten.route.label")}: ${description}`}
        title={description}
        data-route-match={tone}
        className={`shrink-0 cursor-help select-none text-[0.65rem] leading-none ${TONE_CLASSES[tone]}`}
      >
        {TONE_SYMBOLS[tone]}
      </span>
      {needsReview ? (
        <span
          role="img"
          aria-label={t("ritten.route.reviewNeeded")}
          title={t("ritten.route.reviewNeeded")}
          data-route-review="needed"
          className="shrink-0 cursor-help select-none text-[0.65rem] font-bold leading-none text-warning"
        >
          ⚠
        </span>
      ) : null}
    </>
  );
}

/** The tones of a route that priced the Trip — the only ones with a price to check. */
const PRICED_TONES: readonly RouteMatchTone[] = ["matched", "approximate"];

const TONE_SYMBOLS: Record<RouteMatchTone, string> = {
  matched: "●",
  approximate: "≈",
  unmatched: "!",
  unknown: "?",
};

const TONE_CLASSES: Record<RouteMatchTone, string> = {
  matched: "text-muted",
  approximate: "font-semibold text-warning",
  unmatched: "font-bold text-warning",
  unknown: "text-muted",
};

/** One line per leg, then the Over ST it applied — the tooltip text. */
function describe(
  routeMatch: RouteMatch,
  tone: RouteMatchTone,
  t: ReturnType<typeof useTranslation>,
): string {
  if (tone === "unknown") {
    return t("pricing.route.notRecorded");
  }

  if (tone === "unmatched") {
    return t(`pricing.route.method.${routeMatch.method as "NOT_FOUND" | "AMBIGUOUS"}`);
  }

  const legs = legsInOrder(routeMatch).map((leg) => {
    const position = leg.legPosition === null ? "" : `${t("pricing.route.leg")} ${leg.legPosition}: `;

    return `${position}${formatRoad(leg)} (${t(`pricing.route.method.${leg.method}`)})`;
  });
  const overSt = routeMatch.overSt?.applied
    ? [`${t("pricing.route.overSt")}: ${t("pricing.route.overSt.applied")}`]
    : [];

  return [...legs, ...overSt].join("\n");
}
