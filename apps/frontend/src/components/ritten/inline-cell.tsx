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
 *
 * ── A CHOICE SAVES ITSELF; TYPED TEXT DOES NOT ──────────────────────────────
 * `savesOnSelect` turns a dropdown into a control that persists the moment an
 * option is picked. Choosing IS the decision — there is no half-finished state
 * to protect, the way there is while somebody is typing a container number and
 * may still change their mind — so a Save button after it only asks the
 * operator to confirm what they have just said.
 *
 * Nothing about the contract changes: still no optimistic paint, still closed
 * only once the backend accepted it, still the backend's own words on a
 * refusal, and the previous value still on screen behind the open cell.
 * ────────────────────────────────────────────────────────────────────────────
 */

export type InlineCellKind = "text" | "number" | "date" | "time";

/**
 * The browser control each kind uses.
 *
 * `time` gives the browser's own `HH:mm` handling — the same widget the
 * waiting-time editor uses — so nothing here parses or formats a clock value.
 */
const INPUT_TYPE_BY_KIND: Record<InlineCellKind, string> = {
  text: "text",
  number: "number",
  date: "date",
  time: "time",
};

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
  savesOnSelect = false,
  savesOnBlur = false,
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
  /**
   * Persist as soon as an option is chosen, with no Save button.
   *
   * Only meaningful together with `options`: a choice is complete the moment it
   * is made, where typed text is not.
   */
  savesOnSelect?: boolean;
  /**
   * Persist when the field is left, with no Save button.
   *
   * For a clock: the browser's own time control fires a change on every
   * component an operator moves through, so saving on change would send a
   * request per keystroke. Leaving the field is the moment the value is
   * finished, and it saves ONLY when the value actually differs — tabbing
   * through a cell without touching it sends nothing.
   */
  savesOnBlur?: boolean;
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

  /*
   * Takes the value explicitly, because a select saves from inside its own
   * change handler — where the state update has not landed yet, and reading
   * `value` would persist the PREVIOUS option.
   */
  async function save(nextValue: string = value): Promise<void> {
    setIsSaving(true);
    setError(null);

    try {
      await onSave(nextValue);
      setIsEditing(false);
    } catch (caught: unknown) {
      /*
       * The cell stays open showing the reason, and `value` keeps what was
       * attempted so it can be corrected. The ROW behind it still shows the
       * previous vehicle: nothing was painted, so nothing has to be undone.
       */
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
          onChange={(event) => {
            setValue(event.target.value);

            if (savesOnSelect) {
              void save(event.target.value);
            }
          }}
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
          type={INPUT_TYPE_BY_KIND[kind]}
          value={value}
          disabled={isSaving}
          maxLength={maxLength}
          min={min}
          max={max}
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => {
            if (savesOnBlur && value !== editValue) {
              void save();
            }
          }}
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
        {/*
          No Save where choosing already saved. The saving state still shows,
          because the row does not change until the backend has answered.
        */}
        {savesOnSelect || savesOnBlur ? (
          isSaving ? (
            <span className="px-2 py-0.5 text-xs font-medium text-muted">
              {t("ritten.edit.saving")}
            </span>
          ) : null
        ) : (
          <button
            type="button"
            onClick={() => void save()}
            disabled={isSaving}
            className="rounded bg-primary px-2 py-0.5 text-xs font-medium text-white hover:bg-primary-hover disabled:opacity-50"
          >
            {isSaving ? t("ritten.edit.saving") : t("ritten.edit.save")}
          </button>
        )}
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
