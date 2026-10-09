"use client";

import { Suspense, useCallback, useState } from "react";

import { PriceSettingsSection } from "@/components/pricing/price-settings-section";
import { RoutePricesSection } from "@/components/pricing/route-prices-section";
import { useAsync } from "@/hooks/use-async";
import { userFacingMessage } from "@/lib/api/client";
import {
  listCombinationRouteConfigurations,
  listRouteConfigurations,
} from "@/lib/api/route-configuration";
import { listSettings } from "@/lib/api/settings";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { TranslationKey } from "@/lib/i18n/translations";

/**
 * Settings → Prijzen.
 *
 * ── WHAT AN OPERATOR CONFIGURES HERE ────────────────────────────────────────
 * The inputs the Pricing Engine reads from configuration: what each route
 * costs — ordinary routes and Combination routes alike — and the few numbers
 * that apply to all of them. Everything else a price is made of is either a
 * Custom Property (its own settings page) or a fact about the Trip.
 *
 * ── THE PAGE IS A SHELL ─────────────────────────────────────────────────────
 * It loads the three things the sections read and shows one message when a save
 * succeeds or fails. The sections themselves own their forms, because route
 * prices and price settings are different screens that happen to sit together.
 *
 * ── NOTHING HERE CALCULATES ─────────────────────────────────────────────────
 * No price is derived, summed or converted in the browser. Amounts are sent as
 * typed and displayed as the backend formatted them.
 *
 * ── AND NOTHING HERE TOUCHES HISTORY ────────────────────────────────────────
 * Changing configuration affects the NEXT calculation. A Trip already closed
 * keeps the amounts it was priced with, including the fuel percentage that
 * applied on the day — the page says so, because an operator changing a rate
 * deserves to know it will not rewrite last month's invoices.
 * ────────────────────────────────────────────────────────────────────────────
 */

interface Feedback {
  readonly messageKey: TranslationKey;
  readonly detail?: string;
  readonly isError: boolean;
}

export default function PricingSettingsPage() {
  // The route list keeps its view state in the address (useSearchParams),
  // which needs a Suspense boundary on a statically rendered page.
  return (
    <Suspense fallback={null}>
      <PricingSettings />
    </Suspense>
  );
}

function PricingSettings() {
  const t = useTranslation();
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const settings = useAsync(
    useCallback((signal: AbortSignal) => listSettings(signal), []),
    [],
  );
  const routes = useAsync(
    useCallback((signal: AbortSignal) => listRouteConfigurations(signal), []),
    [],
  );
  /*
   * Read separately from the ordinary routes, because a Combination is one record
   * with two legs rather than two routes that happen to be related. Listing the
   * legs among the routes would offer an operator a leg to edit or delete on its
   * own, and half a Combination prices one direction and charges nothing for the
   * other.
   */
  const combinations = useAsync(
    useCallback(
      (signal: AbortSignal) => listCombinationRouteConfigurations(signal),
      [],
    ),
    [],
  );

  /**
   * What happened, in the words of the action that happened.
   *
   * A removal that worked used to be announced as "Opgeslagen", which is the
   * wrong verb for the button that was pressed.
   */
  function reportDone(
    messageKey: TranslationKey = "settings.pricing.saved",
  ): void {
    setFeedback({ messageKey, isError: false });
  }

  /**
   * What went wrong, in the words of the action that went wrong.
   *
   * The key is given by the caller because this page does two different things:
   * a failed deletion used to be announced as "Opslaan mislukt", which told an
   * operator the wrong story about the wrong action.
   */
  function reportFailure(
    error: unknown,
    messageKey: TranslationKey = "settings.pricing.failed",
  ): void {
    setFeedback({
      messageKey,
      detail: userFacingMessage(error),
      isError: true,
    });
  }

  return (
    <div className="mx-auto max-w-[1200px] space-y-6">
      <h1 className="text-xl font-semibold text-foreground">
        {t("settings.pricing.title")}
      </h1>

      {feedback ? (
        <p
          role="status"
          className={`rounded-md border px-4 py-2 text-sm ${
            feedback.isError
              ? "border-danger/30 bg-danger/5 text-foreground"
              : "border-success/30 bg-success/5 text-foreground"
          }`}
        >
          {t(feedback.messageKey)}
          {feedback.detail ? ` ${feedback.detail}` : null}
        </p>
      ) : null}

      {/*
        The routes come first: they are what an operator opens this page to
        change. The numbers below them are configured once and then left alone
        for months, which is why they are folded away rather than in the way.
      */}
      <RoutePricesSection
        routes={routes}
        combinations={combinations}
        onSaved={(messageKey) => {
          routes.reload();
          combinations.reload();
          reportDone(messageKey);
        }}
        /*
         * An inline edit changes one route and the backend answered with it, so
         * the section already holds the newer of the two answers. Reporting it
         * without a refetch is the whole difference.
         */
        onReported={reportDone}
        onFailed={reportFailure}
      />

      <PriceSettingsSection
        settings={settings}
        onSaved={() => {
          settings.reload();
          reportDone();
        }}
        onFailed={reportFailure}
      />
    </div>
  );
}
