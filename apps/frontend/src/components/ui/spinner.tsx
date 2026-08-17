import { cn } from "@/lib/cn";

/**
 * The loading indicator.
 *
 * `role="status"` with a label makes the wait perceivable to a screen reader,
 * which a purely visual spinner would not be.
 */
export function Spinner({
  className,
  label = "Loading",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <span role="status" aria-live="polite" className="inline-flex items-center gap-2">
      <span
        aria-hidden="true"
        className={cn(
          "h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary",
          className,
        )}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
