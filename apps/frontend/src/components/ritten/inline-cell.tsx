"use client";

import { useEffect, useRef, useState } from "react";

import { ApiError, userFacingMessage } from "@/lib/api/client";
import { useTranslation } from "@/lib/i18n/language-provider";

/**
 * One editable cell.
 *
 * The contract is deliberately narrow: it shows a value, it can be opened for
 * editing, and on save it hands a STRING to its owner. Turning that string into
 * the field's payload — and in particular deciding what an empty box means — is
 * the row's job, because the null semantics differ per field and the backend
 * documents them per field.
 *
 * NOTHING IS UPDATED OPTIMISTICALLY. The cell closes only after the backend has
 * accepted the change, and what appears afterwards is whatever the refetched
 * Trip says. A cell that painted the new value itself would show an edit the
 * backend may have adjusted or refused.
 *
 * A rejection stays in the cell: the message is the backend's own, and the
 * field-level details it returns are listed underneath, which is what makes a
 * validation failure actionable rather than merely visible.
 */

export type InlineCellKind = "text" | "number" | "date";

export interface InlineOption {
  readonly value: string;
  readonly label: string;
}

export function InlineCell({
  label,
  displayValue,
  editValue,
  kind = "text",
  options,
  maxLength,
  min,
  max,
  isDisabled,
  onSave,
}: {
  /** Names the field for a screen reader; the column header is not enough. */
  label: string;
  displayValue: React.ReactNode;
  /** The current value as the input should show it. */
  editValue: string;
  kind?: InlineCellKind;
  /** Present for a select; the empty option is supplied by the caller. */
  options?: readonly InlineOption[];
  maxLength?: number;
  min?: number;
  max?: number;
  isDisabled?: boolean;
  onSave: (value: string) => Promise<void>;
}) {
  const t = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(editValue);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
    }
  }, [isEditing]);

  function open(): void {
    setValue(editValue);
    setError(null);
    setIsEditing(true);
  }

  function cancel(): void {
    setIsEditing(false);
    setError(null);
  }

  async function save(): Promise<void> {
    setIsSaving(true);
    setError(null);

    try {
      await onSave(value);
      setIsEditing(false);
    } catch (caught: unknown) {
      setError(caught);
    } finally {
      setIsSaving(false);
    }
  }

  if (!isEditing) {
    return (
      <button
        type="button"
        onClick={open}
        disabled={isDisabled}
        aria-label={label}
        className="w-full rounded px-1 py-0.5 text-left hover:bg-primary/10 disabled:cursor-not-allowed disabled:hover:bg-transparent"
      >
        {displayValue}
      </button>
    );
  }

  return (
    <div className="min-w-40 rounded border border-primary bg-card p-1">
      <label className="sr-only" htmlFor={`inline-${label}`}>
        {label}
      </label>

      {options ? (
        <select
          id={`inline-${label}`}
          ref={inputRef as React.Ref<HTMLSelectElement>}
          value={value}
          disabled={isSaving}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => event.key === "Escape" && cancel()}
          className="w-full rounded border border-border bg-card px-1.5 py-1 text-sm text-foreground"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={`inline-${label}`}
          ref={inputRef as React.Ref<HTMLInputElement>}
          type={kind === "number" ? "number" : kind === "date" ? "date" : "text"}
          value={value}
          disabled={isSaving}
          maxLength={maxLength}
          min={min}
          max={max}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              cancel();
            }

            if (event.key === "Enter") {
              void save();
            }
          }}
          className="w-full rounded border border-border bg-card px-1.5 py-1 text-sm text-foreground"
        />
      )}

      <div className="mt-1 flex items-center gap-1">
        <button
          type="button"
          onClick={() => void save()}
          disabled={isSaving}
          className="rounded bg-primary px-2 py-0.5 text-xs font-medium text-white hover:bg-primary-hover disabled:opacity-50"
        >
          {isSaving ? t("ritten.edit.saving") : t("ritten.edit.save")}
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={isSaving}
          className="rounded border border-border px-2 py-0.5 text-xs font-medium text-foreground hover:bg-hover disabled:opacity-50"
        >
          {t("ritten.edit.cancel")}
        </button>
      </div>

      {error ? <CellError error={error} /> : null}
    </div>
  );
}

/**
 * The backend's refusal, as the backend worded it.
 *
 * `details` carries the field-level messages its validation produced, and they
 * are the useful half — "containerNumber must be shorter than or equal to 100
 * characters" tells a user what to change, where "Validation failed" does not.
 */
function CellError({ error }: { error: unknown }) {
  const details =
    error instanceof ApiError && Array.isArray(error.details)
      ? (error.details as string[])
      : [];

  return (
    <p role="alert" className="mt-1 text-xs text-danger">
      {userFacingMessage(error)}
      {details.length > 0 ? (
        <span className="mt-0.5 block">{details.join(" · ")}</span>
      ) : null}
    </p>
  );
}
