"use client";

import { useSearchParams } from "next/navigation";
import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";

import { replaceCurrentUrl } from "@/lib/navigation/history-entry";
import type { UrlStateCodec } from "@/lib/navigation/url-state-codecs";

/**
 * `useState`, kept in the page's address.
 *
 * ── WHY THE ADDRESS ─────────────────────────────────────────────────────────
 * Going Back to a list has to bring back the list the user left: the same day,
 * view, filters, sort and page. React state dies with the page, so that state
 * is written into the URL of the entry the user is on — and Back, Forward and
 * a reload then restore it the way the browser restores any address.
 *
 * ── HOW, PRECISELY ──────────────────────────────────────────────────────────
 *   * React state stays the source of what is rendered, so a keystroke in a
 *     search box is drawn at once and never waits for the router.
 *   * The address is read ONCE, when the page mounts. Back and Forward mount
 *     the page again, so that is when it matters.
 *   * Every change replaces the current entry's address. It never pushes: a
 *     filter is not a step for Back to undo, and the entry — with its scroll
 *     position — stays the same entry.
 *   * Nothing is written while the page mounts, only when the value changes.
 *     The router is not ready for a rewritten address at that moment (see
 *     `history-entry`), and an address the page was opened with is left as
 *     it was given.
 *
 * The codec must be a module-level constant, like a reducer.
 */
export function useUrlState<TValue>(
  codec: UrlStateCodec<TValue>,
): [TValue, Dispatch<SetStateAction<TValue>>] {
  const searchParams = useSearchParams();
  const [value, setValue] = useState<TValue>(() =>
    codec.read(new URLSearchParams(searchParams?.toString() ?? addressSearch())),
  );

  // Compared by value, so React's development double-mount writes nothing.
  const written = useRef(value);

  useEffect(() => {
    if (Object.is(written.current, value)) {
      return;
    }

    written.current = value;
    const url = new URL(window.location.href);
    codec.write(value, url.searchParams);

    if (url.search !== window.location.search) {
      replaceCurrentUrl(`${url.pathname}${url.search}${url.hash}`);
    }
  }, [codec, value]);

  return [value, setValue];
}

/**
 * The query string when no router provides one — a component rendered outside
 * the App Router, as in a unit test. On the server there is none.
 */
function addressSearch(): string {
  return typeof window === "undefined" ? "" : window.location.search;
}
