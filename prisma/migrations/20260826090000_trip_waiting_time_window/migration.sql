-- The two clock times a waiting time was read off.
--
-- waiting_time_minutes stays: it is what pricing bills from, and it remains
-- the authoritative figure for money. These two say where that figure came
-- from, which was not recoverable once only the total was kept.
--
-- Nullable and NOT backfilled. A stored duration has unlimited begin/end pairs,
-- so every Trip entered before this keeps its minutes and shows no times —
-- inventing "10:00 - 12:15" from 135 minutes would put hours on screen that
-- nobody ever read off a clock.
--
-- TIME, matching start_time/end_time: the window is always less than a day.
ALTER TABLE "trip"
  ADD COLUMN "waiting_time_start" TIME(6) NULL,
  ADD COLUMN "waiting_time_end"   TIME(6) NULL;
