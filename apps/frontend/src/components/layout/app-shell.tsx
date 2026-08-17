"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { Brand, BrandMark } from "./brand";
import { LanguageSelect } from "./language-select";
import { MAIN_NAVIGATION, isActiveRoute } from "./navigation";
import { SettingsMenu } from "./settings-menu";
import { ThemeToggle } from "./theme-toggle";
import { useTranslation } from "@/lib/i18n/language-provider";
import { cn } from "@/lib/cn";

/**
 * The frame every page is rendered inside.
 *
 * A header rather than a sidebar: the product has eight top-level sections and
 * a settings menu, which fit comfortably across the top and leave the full
 * width to the tables and planning views that need it.
 *
 * Everything here is translated through `t()` — the shell is the one part of
 * the application that is fully bilingual today.
 */
/**
 * Routes that own the whole viewport and must not carry the header.
 *
 * The login page is its own full-screen composition; wrapping it in the
 * application chrome would show the navigation of a product the visitor has
 * not signed into yet.
 */
const CHROMELESS_ROUTES: readonly string[] = ["/auth"];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const t = useTranslation();

  if (CHROMELESS_ROUTES.some((route) => isActiveRoute(pathname, route))) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* Lets a keyboard user jump past the navigation on every page. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:text-foreground"
      >
        {t("app.skipToContent")}
      </a>

      <header className="border-b border-navigation-border bg-navigation">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2 px-6 py-3">
          {/*
            Visually stable across every route: same position, same link.

            Which asset appears is a question of ROOM, and it is answered in CSS
            so that both server and browser render the same markup. The wordmark
            needs about 150px it does not have on a phone, where the navigation
            already wraps; the square mark says the same thing in 36.
          */}
          <Link
            href="/dashboard"
            aria-label={t("app.home")}
            className="shrink-0 rounded-md"
          >
            <Brand size="header" className="hidden sm:block" />
            <BrandMark size={36} className="sm:hidden" isDecorative />
          </Link>

          <nav
            aria-label={t("navigation.main")}
            className="flex min-w-0 flex-1 flex-wrap items-center gap-1"
          >
            {MAIN_NAVIGATION.map((item) => {
              const isActive = isActiveRoute(pathname, item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "rounded-md px-3 py-2 text-sm font-medium",
                    isActive
                      ? "bg-navigation-raised text-navigation-foreground"
                      : "text-navigation-muted hover:bg-navigation-raised hover:text-navigation-foreground",
                  )}
                >
                  {t(item.labelKey)}
                </Link>
              );
            })}

            <SettingsMenu pathname={pathname} />
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <LanguageSelect />
            <ThemeToggle />
            {/*
              A link, not a button with an onClick: `/auth/logout` is a real
              endpoint served by the Auth0 middleware. It ends the session at
              Auth0 — not merely in this browser — and returns here. Clearing
              client state alone would leave the Auth0 session intact, so the
              next visit would sign straight back in without asking.
            */}
            <a
              href="/auth/logout"
              className="rounded-md border border-navigation-border px-3 py-1.5 text-sm font-medium text-navigation-muted hover:bg-navigation-raised hover:text-navigation-foreground"
            >
              {t("auth.logout")}
            </a>
          </div>
        </div>
      </header>

      <main id="main-content" className="flex-1 px-6 py-6">
        {children}
      </main>
    </div>
  );
}
