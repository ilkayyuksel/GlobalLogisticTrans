"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { AgendaView } from "@/components/agenda/agenda-view";
import { today } from "@/lib/calendar/calendar-dates";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The Agenda.
 *
 * `?date=` opens a given day and `?event=` one of its items — the links the
 * Dashboard's Agenda uses. Anything else opens today.
 */
export default function CalendarPage() {
  // useSearchParams needs a Suspense boundary on a statically rendered page.
  return (
    <Suspense fallback={null}>
      <CalendarFromAddress />
    </Suspense>
  );
}

function CalendarFromAddress() {
  const params = useSearchParams();
  const date = params.get("date");

  return (
    <AgendaView
      initialDate={date && ISO_DATE_PATTERN.test(date) ? date : today()}
      initialEventId={params.get("event")}
    />
  );
}
