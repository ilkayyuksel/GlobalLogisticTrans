"use client";

import { Badge } from "@/components/ui/badge";
import type { AppliedOverSt, RouteMatch, RouteMatchLeg } from "@/lib/api/types";
import { useTranslation } from "@/lib/i18n/language-provider";
import {
  formatRoad,
  legsInOrder,
  routeMatchTone,
  type RouteMatchTone,
} from "@/lib/pricing/route-match-display";

/**
 * Which configured route the stored price on this panel came from.
 *
 * Rendered from the snapshot's own record — the road(s) as they were
 * configured when the price was calculated, how they matched, and the Over ST
 * the calculation applied. Nothing is matched again here, so a configuration
 * changed or removed since does not change what this price says about itself.
 */
export function RouteMatchSection({ routeMatch }: { routeMatch: RouteMatch }) {
  const t = useTranslation();
  const tone = routeMatchTone(routeMatch);

  return (
    <section
      aria-label={t("pricing.route.title")}
      className="mx-5 mt-4 rounded-md border border-border px-4 py-3 text-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium text-foreground">{t("pricing.route.title")}</h3>
        <MethodBadge routeMatch={routeMatch} tone={tone} />
      </div>
      <p className="mt-0.5 text-xs text-muted">{t("pricing.route.source")}</p>

      <RouteMatchBody routeMatch={routeMatch} tone={tone} />
    </section>
  );
}

function RouteMatchBody({
  routeMatch,
  tone,
}: {
  routeMatch: RouteMatch;
  tone: RouteMatchTone;
}) {
  const t = useTranslation();

  if (tone === "unknown") {
    return <p className="mt-2 text-secondary">{t("pricing.route.notRecorded")}</p>;
  }

  if (tone === "unmatched") {
    return (
      <p role="status" className="mt-2 font-medium text-warning">
        {t(`pricing.route.method.${routeMatch.method as "NOT_FOUND" | "AMBIGUOUS"}`)}
      </p>
    );
  }

  return (
    <>
      {routeMatch.combinationRouteGroupId ? (
        <p className="mt-2 text-xs text-muted">
          {t("pricing.route.combination")}{" "}
          <span className="font-mono">{routeMatch.combinationRouteGroupId}</span>
        </p>
      ) : null}

      <ul className="mt-2 space-y-1.5">
        {legsInOrder(routeMatch).map((leg) => (
          <LegRow key={leg.routePricingId} leg={leg} />
        ))}
      </ul>

      {routeMatch.overSt ? <OverStSummary overSt={routeMatch.overSt} /> : null}
    </>
  );
}

function LegRow({ leg }: { leg: RouteMatchLeg }) {
  const t = useTranslation();

  return (
    <li className="flex flex-wrap items-baseline gap-x-2">
      {leg.legPosition !== null ? (
        <span className="text-xs font-medium uppercase text-muted">
          {t("pricing.route.leg")} {leg.legPosition}
        </span>
      ) : null}
      <span className="text-foreground">{formatRoad(leg)}</span>
      <span className="text-xs text-secondary">
        {t(`pricing.route.method.${leg.method}`)}
      </span>
      {leg.legPosition !== null && leg.isPricedLeg ? (
        <span className="text-xs text-primary">({t("pricing.route.thisTrip")})</span>
      ) : null}
      <span className="text-xs text-muted">
        {t("pricing.route.configuration")}{" "}
        <span className="font-mono">{leg.routePricingId}</span>
      </span>
    </li>
  );
}

/** The Over ST the stored calculation applied, read from its own lines. */
function OverStSummary({ overSt }: { overSt: AppliedOverSt }) {
  const t = useTranslation();

  return (
    <div className="mt-3 border-t border-border pt-2">
      <p className="text-foreground">
        {t("pricing.route.overSt")}:{" "}
        <span className="font-medium">
          {overSt.applied
            ? t("pricing.route.overSt.applied")
            : t("pricing.route.overSt.notApplied")}
        </span>
      </p>
      {overSt.applied ? (
        <dl className="mt-1 grid grid-cols-[auto_auto] justify-start gap-x-4 text-xs text-secondary">
          <dt>{t("pricing.route.overSt.tarief")}</dt>
          <dd className="tabular-nums">{overSt.tarief}</dd>
          <dt>{t("pricing.route.overSt.toll")}</dt>
          <dd className="tabular-nums">{overSt.toll}</dd>
          <dt>{t("pricing.route.overSt.tunnel")}</dt>
          <dd className="tabular-nums">{overSt.tunnel}</dd>
          <dt>{t("pricing.route.overSt.surcharge")}</dt>
          <dd className="tabular-nums">{overSt.surcharge}</dd>
        </dl>
      ) : null}
    </div>
  );
}

/*
 * A classification, not a lifecycle state: the filled lifecycle colours are
 * left alone (see `Badge`). Only what needs a second look is emphasised.
 */
const TONE_TO_BADGE = {
  matched: "outline",
  approximate: "warning",
  unmatched: "warning",
  unknown: "outline",
} as const;

function MethodBadge({ routeMatch, tone }: { routeMatch: RouteMatch; tone: RouteMatchTone }) {
  const t = useTranslation();

  return (
    <Badge tone={TONE_TO_BADGE[tone]}>
      {routeMatch.method ?? "—"}
      <span className="sr-only">
        {" "}
        {t("pricing.route.method")}
      </span>
    </Badge>
  );
}
