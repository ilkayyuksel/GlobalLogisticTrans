"use client";

import { useTranslation } from "@/lib/i18n/language-provider";
import { isNextDayImplied } from "@/lib/waiting-time";

/**
 * "Volgende dag": whether the waiting window's end is on the next day.
 *
 * The two fields hold a time of day, so 10:00 → 12:00 cannot say on its own
 * that the truck left at noon the NEXT day. This tick says it.
 *
 * An end BEFORE its begin can only be the next day, so the tick is shown set
 * and fixed then — unticking it could not make the window a same-day one, and
 * offering the choice would suggest otherwise. The backend applies the same
 * reading and stores it.
 *
 * Shared by every editor of the window, so the choice looks and behaves the
 * same in the table, the detail form and the new-Trip dialog.
 */
export function WaitingNextDayField({
  id,
  begin,
  end,
  checked,
  onChange,
  isDisabled,
}: {
  id: string;
  begin: string;
  end: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  isDisabled?: boolean;
}) {
  const t = useTranslation();
  const isImplied = isNextDayImplied(begin, end);

  return (
    <label
      htmlFor={id}
      title={isImplied ? t("ritten.waiting.nextDayImplied") : undefined}
      className="inline-flex items-center gap-1 text-xs text-foreground"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked || isImplied}
        disabled={isDisabled || isImplied}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-border accent-primary disabled:opacity-50"
      />
      {t("ritten.waiting.nextDay")}
    </label>
  );
}

/**
 * The flag to send beside a window, or nothing when there is no window.
 *
 * The backend accepts the flag only together with both times; a blank window
 * is a removal (or no change), where the flag has nothing to mean.
 */
export function nextDayPayload(
  begin: string,
  end: string,
  checked: boolean,
): { waitingTimeEndsNextDay?: boolean } {
  if (begin.trim() === "" || end.trim() === "") {
    return {};
  }

  return { waitingTimeEndsNextDay: checked || isNextDayImplied(begin, end) };
}
