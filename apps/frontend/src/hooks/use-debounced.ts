"use client";

import { useEffect, useState } from "react";

/**
 * The value as it was `delayMs` ago, once it stops changing.
 *
 * Used for the search box so typing a booking number sends one request instead
 * of one per keystroke. Deliberately tiny: this is the only thing in the
 * application that needs debouncing, and it needs nothing more than this.
 */
export function useDebounced<TValue>(value: TValue, delayMs: number): TValue {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);

    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
