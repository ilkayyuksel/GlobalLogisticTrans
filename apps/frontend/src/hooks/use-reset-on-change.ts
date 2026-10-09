"use client";

import { useEffect, useRef } from "react";

/**
 * Runs `reset` when `value` changes — but not when the component mounts.
 *
 * A list goes back to page 1 when its filters change, because page 4 of a
 * narrower result is usually an empty screen. Doing that on mount as well,
 * which a plain effect does, would throw away the page a user returns to with
 * Back. Comparing with the previous value rather than counting runs also keeps
 * React's development double-mount from resetting anything.
 *
 * `value` must keep its identity while it is unchanged — a memoised query.
 */
export function useResetOnChange(value: unknown, reset: () => void): void {
  const previous = useRef(value);

  useEffect(() => {
    if (previous.current === value) {
      return;
    }

    previous.current = value;
    reset();
    // `reset` is a state setter call; only a change of `value` may trigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
}
