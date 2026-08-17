import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { LanguageProvider } from "@/lib/i18n/language-provider";
import { THEME_SCRIPT, ThemeProvider } from "@/lib/theme/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "TRAXO — Transport Operations",
  description:
    "TRAXO — transport operations: planning, trips and pricing for road transport.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    /*
     * `suppressHydrationWarning` is required and narrow: the pre-paint script
     * below sets `class` and `data-theme` on this element before React runs, so
     * the server's markup and the browser's DOM legitimately differ here. The
     * warning is suppressed for this element only — nothing inside it.
     */
    <html lang="nl" suppressHydrationWarning>
      <head>
        {/*
          Runs before the first paint so a dark-mode user never sees a white
          flash. It must be inline and synchronous; an external file or a
          deferred script would paint first and correct afterwards.
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <ThemeProvider>
          <LanguageProvider>
            <AppShell>{children}</AppShell>
          </LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
