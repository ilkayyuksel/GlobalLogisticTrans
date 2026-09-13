"use client";

import { useEffect, useState } from "react";

import { today } from "@/lib/calendar/calendar-dates";

const MINUTES_PER_HOUR = 60;
const REFRESH_INTERVAL_MS = 60_000;

export interface LocalNow {
  /** `YYYY-MM-DD`, the operator's own calendar day. */
  date: string;
  /** Minutes since the operator's local midnight. */
  minute: number;
}

/**
 * The operator's local day and minute, kept current once a minute.
 *
 * Presentation only: it marks today's column and places the current-time line,
 * and decides nothing. The day comes from `today()`, the application's one
 * definition of the operator's day, so the line and the Dashboard agree.
 */
export function useLocalNow(): LocalNow {
  const [now, setNow] = useState(readLocalNow);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(readLocalNow()), REFRESH_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, []);

  return now;
}

function readLocalNow(): LocalNow {
  const current = new Date();

  return {
    date: today(),
    minute: current.getHours() * MINUTES_PER_HOUR + current.getMinutes(),
  };
}
