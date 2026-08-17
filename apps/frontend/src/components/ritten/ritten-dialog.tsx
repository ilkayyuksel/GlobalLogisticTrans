"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { useTranslation } from "@/lib/i18n/language-provider";

/**
 * The shell every Ritten dialog uses.
 *
 * Extracted because there are three of them — the Combination, the Custom
 * Properties and the details editor — and they must behave identically:
 * Escape closes, a click on the backdrop closes, focus lands on the close
 * button, and a click inside never reaches the backdrop.
 */
export function RittenDialog({
  title,
  titleExtra,
  onClose,
  children,
}: {
  title: string;
  /** A badge or marker rendered beside the title. */
  titleExtra?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useTranslation();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", onKeyDown);

    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-navigation/60 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        className="mt-10 w-full max-w-2xl rounded-lg border border-border bg-card shadow-lg"
      >
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
            {title}
            {titleExtra}
          </h2>

          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-hover"
          >
            {t("ritten.group.close")}
          </button>
        </header>

        {children}
      </div>
    </div>
  );
}
