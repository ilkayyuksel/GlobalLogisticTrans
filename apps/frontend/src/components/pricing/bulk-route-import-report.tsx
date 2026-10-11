"use client";

import type {
  BulkRouteImportError,
  BulkRouteImportSkipped,
  BulkRouteImportSummary,
} from "@/lib/api/route-configuration";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { TranslationKey } from "@/lib/i18n/translations";

/**
 * The reasons an operator reads in their own language. A field-level problem
 * keeps the backend's own words, because they name the field and the rule.
 */
const REASON_KEYS: Record<NonNullable<BulkRouteImportError["code"]>, TranslationKey | null> = {
  SAME_ROUTE_LEGS: "settings.pricing.routes.bulk.reason.sameRouteLegs",
  DUPLICATE_IN_IMPORT: "settings.pricing.routes.bulk.reason.duplicateInImport",
  ALREADY_CONFIGURED: "settings.pricing.routes.bulk.reason.alreadyConfigured",
  INVALID: null,
};

/** What was (or would be) created, as counts. */
export function BulkRouteImportCounts({ summary }: { summary: BulkRouteImportSummary }) {
  const t = useTranslation();

  return (
    <ul className="mt-2 space-y-0.5 text-sm text-secondary">
      <li>{`${summary.normalRoutes} ${t("settings.pricing.routes.bulk.normalRoutes")}`}</li>
      <li>{`${summary.combinationGroups} ${t("settings.pricing.routes.bulk.combinationGroups")}`}</li>
      <li>{`${summary.combinationLegs} ${t("settings.pricing.routes.bulk.combinationLegs")}`}</li>
      <li className="font-medium text-foreground">
        {`${t("settings.pricing.routes.bulk.total")}: ${summary.totalRoutes}`}
      </li>
    </ul>
  );
}

/** Every skipped entry: its number, the route it names, and why. */
export function BulkRouteImportSkippedList({ skipped }: { skipped: readonly BulkRouteImportSkipped[] }) {
  const t = useTranslation();

  if (skipped.length === 0) {
    return null;
  }

  return (
    <div className="mt-3">
      <h4 className="text-sm font-semibold text-foreground">
        {t("settings.pricing.routes.bulk.skippedTitle").replace("{count}", String(skipped.length))}
      </h4>
      <ul className="mt-1 space-y-1 text-sm text-danger">
        {skipped.flatMap((entry) =>
          entry.reasons.map((reason, index) => (
            <li key={`${entry.routeNumber}-${index}`}>
              {`${t("settings.pricing.routes.bulk.route")} ${entry.routeNumber}`}
              {entry.route ? ` (${entry.route})` : ""}
              {reason.legNumber === null
                ? ""
                : `, ${t("settings.pricing.routes.combinations.leg")} ${reason.legNumber}`}
              {` — ${reasonText(reason, t)}`}
            </li>
          )),
        )}
      </ul>
    </div>
  );
}

function reasonText(reason: BulkRouteImportError, t: (key: TranslationKey) => string): string {
  const key = reason.code === null ? null : REASON_KEYS[reason.code];

  return key === null ? reason.message : t(key);
}

/** A problem with the document itself: it belongs to no entry. */
export function BulkRouteImportDocumentErrors({ errors }: { errors: readonly BulkRouteImportError[] }) {
  const t = useTranslation();
  const ofDocument = errors.filter((error) => error.routeNumber === null);

  if (ofDocument.length === 0) {
    return null;
  }

  return (
    <ul className="mt-3 space-y-1 text-sm text-danger">
      {ofDocument.map((error, index) => (
        <li key={index}>{`${t("settings.pricing.routes.bulk.document")}: ${error.message}`}</li>
      ))}
    </ul>
  );
}
