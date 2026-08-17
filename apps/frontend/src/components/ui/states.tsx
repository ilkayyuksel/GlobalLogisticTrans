import type { ReactNode } from "react";

import { userFacingMessage } from "@/lib/api/client";
import { Spinner } from "./spinner";

/**
 * The three states every screen in this application can be in.
 *
 * Collected in one file because they must look and behave identically
 * everywhere: a user should not have to work out whether a blank panel means
 * "still loading", "nothing here" or "it broke".
 */

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 px-5 py-12 text-sm text-secondary">
      <Spinner label={label} />
      <span aria-hidden="true">{label}…</span>
    </div>
  );
}

/**
 * A failure the user can read and act on.
 *
 * The message comes from the backend's error envelope, which is written for
 * people. Raw exceptions never reach this: `userFacingMessage` replaces
 * anything that is not a known API error with a neutral sentence, so an
 * internal stack trace or class name cannot leak into the interface.
 */
export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className="px-5 py-10 text-center">
      <p className="text-sm font-medium text-danger">
        {userFacingMessage(error)}
      </p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-hover"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}

/** Nothing to show, which is a normal outcome rather than a problem. */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="px-5 py-12 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? (
        <p className="mx-auto mt-1 max-w-md text-sm text-secondary">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
