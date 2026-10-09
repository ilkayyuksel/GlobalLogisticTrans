"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";

import { ScrollTracker } from "@/lib/navigation/scroll-tracker";

/**
 * Remembers and restores scroll positions for the whole application.
 *
 * Rendered ONCE, in the root layout, so every route has the same behaviour and
 * no page carries scroll code of its own. It renders nothing; the work is in
 * `ScrollTracker`, and this only tells it when the router has shown a new
 * address.
 */
export function ScrollRestoration() {
  // useSearchParams needs a Suspense boundary on a statically rendered page;
  // this one wraps nothing visible, so its fallback is nothing too.
  return (
    <Suspense fallback={null}>
      <RouteScrollRestoration />
    </Suspense>
  );
}

function RouteScrollRestoration() {
  const pathname = usePathname();
  const search = useSearchParams()?.toString() ?? "";
  const trackerRef = useRef<ScrollTracker | null>(null);

  useEffect(() => {
    const tracker = new ScrollTracker();
    trackerRef.current = tracker;
    const stop = tracker.start();

    return () => {
      stop();
      trackerRef.current = null;
    };
  }, []);

  // Effects of the page run before this one, so the page's own loads are
  // already registered when the tracker decides whether it can restore yet.
  useEffect(() => {
    trackerRef.current?.routeChanged();
  }, [pathname, search]);

  return null;
}
