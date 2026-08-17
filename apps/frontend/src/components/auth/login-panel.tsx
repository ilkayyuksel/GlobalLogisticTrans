"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { LoginBackground } from "@/components/auth/login-background";
import { Brand } from "@/components/layout/brand";
import { LanguageSelect } from "@/components/layout/language-select";
import { useTranslation } from "@/lib/i18n/language-provider";

/**
 * The branded entry point to TRAXO.
 *
 * ── WHAT IS AND IS NOT HERE ─────────────────────────────────────────────────
 * There is no form. Credentials belong to Auth0 Universal Login, on Auth0's own
 * domain; this page's only job is to be recognisably TRAXO and to send the
 * visitor there. Nothing here touches an email address or a password.
 *
 * There is no "register" and no "forgot password", and neither is an omission
 * to be filled in later: TRAXO V1 has exactly one administrator, whose account
 * is created in the Auth0 dashboard. A registration link would offer something
 * the product does not do.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The login control is a link, not a button with an onClick. `/auth/login` is a
 * real endpoint served by the Auth0 middleware, so it works before JavaScript
 * has loaded and behaves like a link because it is one.
 */
export function LoginPanel({ isConfigured }: { isConfigured: boolean }) {
  return (
    // useSearchParams needs a Suspense boundary on a statically rendered page.
    <Suspense fallback={<Panel isConfigured={isConfigured} returnTo={null} />}>
      <PanelWithReturnTo isConfigured={isConfigured} />
    </Suspense>
  );
}

function PanelWithReturnTo({ isConfigured }: { isConfigured: boolean }) {
  const searchParams = useSearchParams();

  return (
    <Panel isConfigured={isConfigured} returnTo={searchParams.get("returnTo")} />
  );
}

function Panel({
  isConfigured,
  returnTo,
}: {
  isConfigured: boolean;
  returnTo: string | null;
}) {
  const t = useTranslation();

  return (
    <LoginBackground>
      {/*
        The language switch is deliberately the only other control. Someone who
        cannot read the page cannot use the button on it. The theme toggle is
        absent because this page is navy in either theme.
      */}
      <div className="absolute right-4 top-4">
        <LanguageSelect />
      </div>

      <div className="w-full max-w-md text-center">
        <Brand size="hero" priority className="mx-auto" />

        {isConfigured ? (
          <>
            <p className="mt-8 text-sm text-white/70">{t("login.intro")}</p>

            <a
              href={loginHref(returnTo)}
              className="mt-6 inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-3 text-sm font-semibold text-white hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-white/60"
            >
              {t("login.submit")}
            </a>

         
          </>
        ) : (
          /*
           * The tenant is provisioned outside this repository, so a complete
           * checkout can still have no Auth0 configuration. Saying so is better
           * than a login button that fails: this states the cause and names
           * what to fill in.
           */
          <div
            role="status"
            className="mt-8 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-left"
          >
            <p className="text-sm font-semibold text-white">
              {t("login.notConfiguredTitle")}
            </p>
            <p className="mt-1 text-sm text-white/70">
              {t("login.notConfiguredDescription")}
            </p>
          </div>
        )}
      </div>
    </LoginBackground>
  );
}

/**
 * Where the login link points.
 *
 * `returnTo` is the page the visitor was trying to reach, carried through the
 * round trip so a bookmarked deep link survives it. Only a path within this
 * application is ever passed on: a full URL here would let a crafted link send
 * someone to another site the moment they signed in, wearing TRAXO's login as
 * the last thing they saw.
 */
export function loginHref(returnTo: string | null): string {
  const isSafeInternalPath =
    returnTo !== null && returnTo.startsWith("/") && !returnTo.startsWith("//");

  return isSafeInternalPath
    ? `/auth/login?returnTo=${encodeURIComponent(returnTo)}`
    : "/auth/login";
}
