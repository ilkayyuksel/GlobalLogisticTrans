import type { ReactNode } from "react";

/**
 * A labelled form field: the small capitalised label the application's forms
 * use, above its control, with an optional hint below it.
 */
export function FormField({
  label,
  htmlFor,
  hint,
  hintId,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  /** Lets the control point at the hint with `aria-describedby`. */
  hintId?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted"
      >
        {label}
      </label>
      {children}
      {hint ? (
        <p id={hintId} className="mt-1 text-xs text-secondary">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
