"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Runs an asynchronous read and reports its three possible states.
 *
 * This is the whole of the application's data-loading strategy. Every page
 * needs loading, error and loaded handled the same way, and a hook does that in
 * a few lines — where a state-management library would add a store, a cache and
 * a set of conventions to a system with two pages and no shared client state.
 *
 * Requests are aborted when the component unmounts or the inputs change, so a
 * response that arrives after the user has moved on cannot overwrite what they
 * are now looking at.
 */

export interface AsyncState<TData> {
  data: TData | null;
  /** True during the first load AND during a reload. */
  isLoading: boolean;
  error: unknown;
  /** Runs the operation again, e.g. from a "Try again" button. */
  reload: () => void;
}

export function useAsync<TData>(
  operation: (signal: AbortSignal) => Promise<TData>,
  /**
   * Values that, when changed, mean the previous result is stale. Same contract
   * as a dependency array.
   */
  dependencies: readonly unknown[],
): AsyncState<TData> {
  const [data, setData] = useState<TData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [reloadCount, setReloadCount] = useState(0);

  // Held in a ref so changing the operation's identity on every render — which
  // an inline arrow function does — cannot restart the request in a loop.
  const operationRef = useRef(operation);
  operationRef.current = operation;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    setIsLoading(true);
    setError(null);

    operationRef
      .current(controller.signal)
      .then((result) => {
        if (active) {
          setData(result);
          setError(null);
        }
      })
      .catch((caught: unknown) => {
        // An abort is this hook cancelling its own work, not a failure the user
        // should see. The component is gone or the inputs changed.
        if (!active || isAbortError(caught)) {
          return;
        }

        setError(caught);
        setData(null);
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, reloadCount]);

  const reload = useCallback(() => {
    setReloadCount((count) => count + 1);
  }, []);

  return { data, isLoading, error, reload };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
