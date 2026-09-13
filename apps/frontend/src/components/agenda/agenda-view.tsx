"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ConfirmDialog } from "@/components/ritten/confirm-dialog";
import { PeriodNav } from "@/components/ritten/period-nav";
import { Card } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { useAsync } from "@/hooks/use-async";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  getCalendarRange,
  updateCalendarEvent,
  type CalendarEvent,
} from "@/lib/api/calendar-events";
import { toAgendaWindow } from "@/lib/calendar/agenda-layout";
import {
  endOfWeek,
  formatCalendarDate,
  startOfWeek,
  weekDays,
} from "@/lib/calendar/calendar-dates";
import { toClockLabel } from "@/lib/calendar/clock";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { TranslationKey } from "@/lib/i18n/translations";
import { AgendaGrid } from "./agenda-grid";
import { AgendaItemDialog, type AgendaItemValues } from "./agenda-item-dialog";

type OpenDialog =
  | { kind: "create"; date: string; startTime: string }
  | { kind: "edit"; item: CalendarEvent }
  | { kind: "delete"; item: CalendarEvent };

/**
 * The Agenda: a week, Monday to Sunday, as a calendar.
 *
 * The week is the backend's answer — its items and the hours a day has — and it
 * is asked for again after every change, so what is drawn is always what is
 * stored. Moving between weeks uses the Ritten navigator: previous, next, this
 * week and a date picker.
 *
 * A Dashboard link names a day and an item; the item opens once its week has
 * arrived.
 */
export function AgendaView({
  initialDate,
  initialEventId,
}: {
  initialDate: string;
  initialEventId: string | null;
}) {
  const t = useTranslation();
  const [anchor, setAnchor] = useState(initialDate);
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const [feedbackKey, setFeedbackKey] = useState<TranslationKey | null>(null);
  const linkedEventId = useRef(initialEventId);
  const from = startOfWeek(anchor);
  const to = endOfWeek(anchor);

  const week = useAsync(
    useCallback((signal: AbortSignal) => getCalendarRange(from, to, signal), [from, to]),
    [from, to],
  );
  // The previous week's answer must never be drawn under the new week's dates.
  const current = week.data?.from === from ? week.data : null;
  const dayWindow = current ? toAgendaWindow(current.dayStart, current.dayEnd) : null;

  useEffect(() => {
    if (!current || !linkedEventId.current) {
      return;
    }

    const linked = current.items.find((item) => item.id === linkedEventId.current);

    linkedEventId.current = null;

    if (linked) {
      setDialog({ kind: "edit", item: linked });
    }
  }, [current]);

  function changeWeek(next: string): void {
    setAnchor(next);
    setFeedbackKey(null);
  }

  function refreshAfter(key: TranslationKey): void {
    week.reload();
    setFeedbackKey(key);
  }

  async function create(values: AgendaItemValues): Promise<void> {
    await createCalendarEvent({
      title: values.title,
      date: values.date,
      startTime: values.startTime,
      ...(values.endTime ? { endTime: values.endTime } : {}),
    });
    refreshAfter("agenda.feedback.created");
  }

  async function update(item: CalendarEvent, values: AgendaItemValues): Promise<void> {
    await updateCalendarEvent(item.id, values);
    refreshAfter("agenda.feedback.updated");
  }

  async function remove(item: CalendarEvent): Promise<void> {
    await deleteCalendarEvent(item.id);
    refreshAfter("agenda.feedback.deleted");
  }

  return (
    <div className="w-full space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">{t("page.calendar.title")}</h1>
        <PeriodNav view="week" anchor={anchor} onChange={changeWeek} />
      </div>

      <p className="text-xs text-secondary">{t("agenda.hint")}</p>

      {feedbackKey ? (
        <p
          role="status"
          className="rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm font-medium text-foreground"
        >
          {t(feedbackKey)}
        </p>
      ) : null}

      <Card className="overflow-hidden">
        {!current && !week.error ? <LoadingState label={t("agenda.loading")} /> : null}

        {week.error && !week.isLoading ? (
          <ErrorState error={week.error} onRetry={week.reload} />
        ) : null}

        {current && dayWindow ? (
          <AgendaGrid
            days={weekDays(anchor)}
            items={current.items}
            window={dayWindow}
            label={t("agenda.weekLabel")}
            onCreateAt={(date, startTime) => setDialog({ kind: "create", date, startTime })}
            onOpen={(item) => setDialog({ kind: "edit", item })}
          />
        ) : null}

        {current && !dayWindow ? (
          <p role="alert" className="px-4 py-6 text-sm text-danger">
            {t("agenda.unavailable")}
          </p>
        ) : null}
      </Card>

      {dialog?.kind === "create" ? (
        <AgendaItemDialog
          date={dialog.date}
          startTime={dialog.startTime}
          onSave={create}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog?.kind === "edit" ? (
        <AgendaItemDialog
          item={dialog.item}
          onSave={(values) => update(dialog.item, values)}
          onDelete={() => setDialog({ kind: "delete", item: dialog.item })}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog?.kind === "delete" ? (
        <ConfirmDialog
          titleKey="agenda.delete.title"
          descriptionKey="agenda.delete.description"
          confirmKey="agenda.delete.confirm"
          tone="danger"
          onConfirm={() => remove(dialog.item)}
          onClose={() => setDialog(null)}
        >
          <div className="rounded-md border border-border px-3 py-2">
            <p className="text-sm font-medium text-foreground">{dialog.item.title}</p>
            <p className="mt-0.5 text-xs tabular-nums text-secondary">
              {formatCalendarDate(dialog.item.date)} ·{" "}
              {toClockLabel(dialog.item.startTime)}–{toClockLabel(dialog.item.endTime)}
            </p>
          </div>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
