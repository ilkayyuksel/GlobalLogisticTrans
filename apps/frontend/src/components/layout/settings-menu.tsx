"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { SETTINGS_NAVIGATION, isSettingsActive } from "./navigation";
import { useTranslation } from "@/lib/i18n/language-provider";
import { cn } from "@/lib/cn";

/**
 * The Settings dropdown.
 *
 * Written by hand rather than pulled from a library, because the keyboard
 * behaviour it needs is small and specific: Enter or Space opens it, Escape
 * closes it and returns focus to the trigger, Tab moves through the items, and
 * a click elsewhere dismisses it. `aria-expanded` and `aria-haspopup` tell a
 * screen reader what the trigger does.
 *
 * The menu stays mounted only while open, so its links are not reachable by Tab
 * when hidden — a closed menu whose contents remain in the tab order is a
 * classic accessibility trap.
 */
export function SettingsMenu({ pathname }: { pathname: string }) {
  const t = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const isActive = isSettingsActive(pathname);

  // A click anywhere outside dismisses the menu, which is what a user expects
  // from every other dropdown they have ever used.
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);

    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isOpen]);

  const close = (returnFocus: boolean) => {
    setIsOpen(false);

    if (returnFocus) {
      triggerRef.current?.focus();
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape" && isOpen) {
          event.stopPropagation();
          close(true);
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className={cn(
          "flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium",
          isActive
            ? "bg-navigation-raised text-navigation-foreground"
            : "text-navigation-muted hover:bg-navigation-raised hover:text-navigation-foreground",
        )}
      >
        {t("navigation.settings")}
        <span aria-hidden="true" className="text-xs">
          ▼
        </span>
      </button>

      {isOpen ? (
        <div
          role="menu"
          aria-label={t("navigation.settings")}
          className="absolute right-0 z-20 mt-1 min-w-52 rounded-md border border-border bg-card py-1 shadow-lg"
        >
          {SETTINGS_NAVIGATION.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              role="menuitem"
              aria-current={pathname === item.href ? "page" : undefined}
              onClick={() => close(false)}
              className={cn(
                "block px-4 py-2 text-sm",
                pathname === item.href
                  ? "bg-primary/10 text-primary"
                  : "text-foreground hover:bg-hover",
              )}
            >
              {t(item.labelKey)}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
