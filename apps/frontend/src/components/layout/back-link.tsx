"use client";

import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";

import { isBackTo } from "@/lib/navigation/back-navigation";

/**
 * A "Terug naar …" link that IS Back when the user came from that page.
 *
 * Followed as a link, it would push a fresh copy of the list: today's date,
 * the default view, no filter and the top of the page. Taken as Back, it
 * returns to the entry the user left — the same one the browser's own Back
 * button returns to, so both restore the same date, view, filters and scroll.
 *
 * It stays a real link: the `href` is what a middle-click, a new tab or a
 * directly opened detail page uses, and those simply open the list.
 */
export function BackLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (isModifiedClick(event) || !isBackTo(href)) {
      return;
    }

    event.preventDefault();
    window.history.back();
  }

  return (
    <Link href={href} className={className} onClick={handleClick}>
      {children}
    </Link>
  );
}

/** A click that asks for a new tab or window, which Back cannot give. */
function isModifiedClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}
