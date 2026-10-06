-- Which day a waiting window ends on.
--
-- waiting_time_start/end are TIME, so "10:00 -> 12:00" could not say that the
-- truck left at noon the NEXT day. This flag says it, and with it the window
-- can span the night: only 06:00-20:00 of each day is counted as waiting time.
--
-- NOT NULL DEFAULT false: every existing window keeps its same-day meaning.
ALTER TABLE "trip"
  ADD COLUMN "waiting_time_ends_next_day" BOOLEAN NOT NULL DEFAULT false;

-- An existing end before its begin was ALREADY read as the next morning. The
-- flag records that reading so the column states the day explicitly for every
-- window. waiting_time_minutes is deliberately left untouched: stored waiting
-- time is historical data and is not recalculated by this migration.
UPDATE "trip"
   SET "waiting_time_ends_next_day" = true
 WHERE "waiting_time_start" IS NOT NULL
   AND "waiting_time_end" IS NOT NULL
   AND "waiting_time_end" < "waiting_time_start";
