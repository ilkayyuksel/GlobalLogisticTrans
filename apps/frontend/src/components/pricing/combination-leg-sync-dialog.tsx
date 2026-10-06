"use client";

import { ConfirmDialog } from "@/components/ritten/confirm-dialog";
import { RittenDialog } from "@/components/ritten/ritten-dialog";
import type { CombinationLegSync } from "@/lib/api/route-configuration";
import { useTranslation } from "@/lib/i18n/language-provider";

/**
 * Confirms copying one leg's prices to every matching leg elsewhere.
 *
 * The preview it shows is the backend's: which Combinations share this leg in
 * this position, and the values that would be copied. Nothing here decides a
 * match or touches an amount.
 *
 * ── NOTHING TO REACH, NOTHING TO CONFIRM ────────────────────────────────────
 * With no other Combination running the leg, there is no action to stop at. The
 * dialog says so and offers only the way out, so an operator cannot "confirm" a
 * sync that would change nothing and come away thinking it did something.
 */
export function CombinationLegSyncDialog({
  preview,
  onConfirm,
  onClose,
}: {
  preview: CombinationLegSync;
  /** Rejects on refusal: the dialog stays open with the backend's reason. */
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslation();
  const leg = `${t("settings.pricing.routes.combinations.leg")} ${preview.legPosition}`;
  const route = `${preview.departure} → ${preview.destination}`;
  const count = preview.targetCombinationGroupIds.length;

  if (count === 0) {
    return (
      <RittenDialog
        title={t("settings.pricing.routes.sync.noTargets")}
        onClose={onClose}
      >
        <div className="px-4 py-3">
          <p className="text-sm font-medium text-foreground">{`${leg} "${route}"`}</p>
          <p className="mt-2 text-sm text-secondary">
            {t("settings.pricing.routes.sync.noTargetsDescription")}
          </p>
        </div>
      </RittenDialog>
    );
  }

  return (
    <ConfirmDialog
      titleKey="settings.pricing.routes.sync.title"
      descriptionKey="settings.pricing.routes.sync.description"
      confirmKey="settings.pricing.routes.sync.confirm"
      onConfirm={onConfirm}
      onClose={onClose}
    >
      <p className="text-sm font-medium text-foreground">
        {t("settings.pricing.routes.sync.question")
          .replace("{leg}", leg)
          .replace("{route}", route)
          .replace("{count}", String(count))}
      </p>
      {/* Exactly as stored — the strings the backend formatted, not recomputed. */}
      <p className="mt-2 text-xs tabular-nums text-secondary">
        {[
          `${t("settings.pricing.routes.tarief")} ${preview.prices.tarief}`,
          `${t("settings.pricing.routes.toll")} ${preview.prices.toll}`,
          `${t("settings.pricing.routes.tunnel")} ${preview.prices.tunnel}`,
        ].join(" · ")}
      </p>
    </ConfirmDialog>
  );
}
