"use client";

import { useEffect, useRef, useState } from "react";

import { ApiError, userFacingMessage } from "@/lib/api/client";
import type { UpdateTripPayload } from "@/lib/api/trips";
import { toClockLabel } from "@/lib/calendar/clock";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { TranslationKey } from "@/lib/i18n/translations";
import {
  formatWaitingTime,
  waitingWindowMinutes,
  type WaitingWindowError,
} from "@/lib/waiting-time";

/**
 * Waiting time: the two clock times it was read off, and the duration between.
 *
 * ── WHY BEGIN AND EIND, NOT A DURATION ──────────────────────────────────────
 * Nobody measures a duration. A driver notes the time the truck arrived and the
 * time it left, and subtracting them in your head at the end of a shift is
 * exactly the step that produces "1 uur 90 min" and mistyped hours. So the
 * editor asks for the two moments.
 *
 * ── ALL THREE ARE STORED NOW ────────────────────────────────────────────────
 * The two times persist beside the duration, so the column can show where the
 * figure came from and the editor can open on what was actually entered. The
 * BACKEND derives the minutes from the window — they are not sent — which is
 * what keeps the money and the evidence for it from disagreeing.
 *
 * A Trip whose waiting time predates the two columns has a duration and no
 * times. It shows the duration alone: 135 minutes has unlimited begin/end
 * pairs, and inventing one would put hours on screen nobody ever read.
 *
 * A window that crosses midnight is ordinary and is handled: 22:00 → 02:00 is
 * four hours. Equal times are zero, never a full day — see `waiting-time.ts`.
 * ────────────────────────────────────────────────────────────────────────────
 */

const ERROR_KEYS: Record<WaitingWindowError, TranslationKey> = {
  beginInvalid: "ritten.waiting.beginRequired",
  endInvalid: "ritten.waiting.endRequired",
};

export function WaitingTimeCell({
  trip,
  isDisabled,
  onSave,
}: {
  trip: {
    bookingNumber: string | null;
    waitingTimeStart: string | null;
    waitingTimeEnd: string | null;
    waitingTimeMinutes: number | null;
  };
  isDisabled?: boolean;
  /** Sends the window; the backend derives the duration from it. */
  onSave: (payload: UpdateTripPayload) => Promise<void>;
}) {
  const t = useTranslation();

  const storedBegin = toClockLabel(trip.waitingTimeStart) ?? "";
  const storedEnd = toClockLabel(trip.waitingTimeEnd) ?? "";

  const [isEditing, setIsEditing] = useState(false);
  const [begin, setBegin] = useState(storedBegin);
  const [end, setEnd] = useState(storedEnd);
  const [isSaving, setIsSaving] = useState(false);
  const [localError, setLocalError] = useState<WaitingWindowError | null>(null);
  const [saveError, setSaveError] = useState<unknown>(null);
  const beginRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      beginRef.current?.focus();
    }
  }, [isEditing]);

  /*
   * The duration as it stands while typing, so the operator sees what will be
   * stored before storing it. The stored value is always the backend's own
   * calculation of the same window; this is a preview, not the source.
   */
  const preview = waitingWindowMinutes(begin, end);

  function open(): void {
    // On what was actually entered, which is now recoverable. A Trip with only
    // a legacy duration opens empty, because there is nothing to reconstruct.
    setBegin(storedBegin);
    setEnd(storedEnd);
    setLocalError(null);
    setSaveError(null);
    setIsEditing(true);
  }

  async function send(payload: UpdateTripPayload): Promise<void> {
    setLocalError(null);
    setSaveError(null);
    setIsSaving(true);

    try {
      await onSave(payload);
      setIsEditing(false);
    } catch (error: unknown) {
      setSaveError(error);
    } finally {
      setIsSaving(false);
    }
  }

  async function save(): Promise<void> {
    const result = waitingWindowMinutes(begin, end);

    if (result.error) {
      setLocalError(result.error);

      return;
    }

    /*
     * Both times or neither: the backend refuses a half-filled window, and an
     * emptied pair is how a waiting time is removed.
     */
    await send({
      waitingTimeStart: begin.trim() === "" ? null : begin.trim(),
      waitingTimeEnd: end.trim() === "" ? null : end.trim(),
    });
  }

  /** Removes the entry: both times and the duration with them. */
  async function remove(): Promise<void> {
    await send({ waitingTimeStart: null, waitingTimeEnd: null });
  }

  if (!isEditing) {
    return (
      <button
        type="button"
        onClick={open}
        disabled={isDisabled}
        aria-label={t("ritten.edit.waitingTime")}
        className="w-full rounded px-1 py-0.5 text-left hover:bg-primary/10 disabled:cursor-not-allowed disabled:hover:bg-transparent"
      >
        <WaitingTimeValue trip={trip} />
      </button>
    );
  }

  return (
    <div className="min-w-44 rounded border border-primary bg-card p-1">
      <div className="flex items-end gap-2">
        <ClockField
          id="waiting-begin"
          ref={beginRef}
          label={t("ritten.waiting.begin")}
          value={begin}
          onChange={setBegin}
          onEnter={() => void save()}
          onEscape={() => setIsEditing(false)}
          isDisabled={isSaving}
        />
        <ClockField
          id="waiting-end"
          label={t("ritten.waiting.end")}
          value={end}
          onChange={setEnd}
          onEnter={() => void save()}
          onEscape={() => setIsEditing(false)}
          isDisabled={isSaving}
        />
      </div>

      {/* What will be stored, in the same words the column uses. */}
      <p className="mt-1 text-[11px] text-muted">
        {t("ritten.waiting.calculated")}:{" "}
        <span className="font-medium text-foreground">
          {preview.error || preview.totalMinutes === null
            ? t("ritten.value.empty")
            : formatWaitingTime(preview.totalMinutes)}
        </span>
      </p>

      <div className="mt-1 flex flex-wrap items-center gap-1">
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
          onClick={() => setIsEditing(false)}
          disabled={isSaving}
          className="rounded border border-border px-2 py-0.5 text-xs font-medium text-foreground hover:bg-hover disabled:opacity-50"
        >
          {t("ritten.edit.cancel")}
        </button>

        {/*
          Removing the ENTRY, not the Trip — which is why it is worded as the
          waiting time and is offered only when there is one to remove. It
          clears all three values together, so nothing is left half-stated.
        */}
        {trip.waitingTimeMinutes === null ? null : (
          <button
            type="button"
            onClick={() => void remove()}
            disabled={isSaving}
            className="ml-auto rounded border border-danger/40 px-2 py-0.5 text-xs font-medium text-danger hover:bg-danger/10 disabled:opacity-50"
          >
            {t("ritten.waiting.remove")}
          </button>
        )}
      </div>

      {localError ? (
        <p role="alert" className="mt-1 text-xs text-danger">
          {t(ERROR_KEYS[localError])}
        </p>
      ) : null}

      {saveError ? <SaveError error={saveError} /> : null}
    </div>
  );
}

/**
 * What the column shows: the window, and the duration under it.
 *
 * The times are the operational fact an operator scans for; the duration is
 * derived from them, so it reads as subordinate — smaller and muted — rather
 * than as a second, competing number.
 *
 * With no window there is only the duration, which then carries the line on its
 * own. With nothing at all, the ordinary empty marker.
 */
function WaitingTimeValue({
  trip,
}: {
  trip: {
    waitingTimeStart: string | null;
    waitingTimeEnd: string | null;
    waitingTimeMinutes: number | null;
  };
}) {
  const t = useTranslation();
  const duration = formatWaitingTime(trip.waitingTimeMinutes);

  if (duration === null) {
    return <>{t("ritten.value.empty")}</>;
  }

  const begin = toClockLabel(trip.waitingTimeStart);
  const end = toClockLabel(trip.waitingTimeEnd);

  if (begin === null || end === null) {
    return <span className="tabular-nums text-secondary">{duration}</span>;
  }

  return (
    <span className="block leading-tight">
      <span className="block whitespace-nowrap tabular-nums text-foreground">
        {begin} – {end}
      </span>
      <span className="block text-[11px] tabular-nums text-muted">
        {duration}
      </span>
    </span>
  );
}

/** A time of day. `type="time"` gives the browser's own HH:mm handling. */
function ClockField({
  id,
  ref,
  label,
  value,
  onChange,
  onEnter,
  onEscape,
  isDisabled,
}: {
  id: string;
  ref?: React.Ref<HTMLInputElement>;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onEnter: () => void;
  onEscape: () => void;
  isDisabled: boolean;
}) {
  return (
    <span className="block">
      <input
        id={id}
        ref={ref}
        type="time"
        aria-label={label}
        value={value}
        disabled={isDisabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            onEnter();
          }

          if (event.key === "Escape") {
            onEscape();
          }
        }}
        className="w-24 rounded border border-border bg-card px-1.5 py-1 text-sm text-foreground"
      />
      <span className="mt-0.5 block text-center text-[11px] text-muted">
        {label}
      </span>
    </span>
  );
}

/** The backend's refusal, with the field-level detail it returned. */
function SaveError({ error }: { error: unknown }) {
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
