-- When the original email of a FAILED import was forwarded to a person.
--
-- ── WHY ON THIS ROW, AND NOT IN A TABLE OF ITS OWN ──────────────────────────
-- `imported_email` already holds exactly one row per Message-ID, and a failed
-- email is retried on every scan for the rest of the day. That row is therefore
-- the one place that can answer "has somebody already been told about this
-- email?" — which is the only question this column exists to answer. A second
-- table would be a second record of the same email.
--
-- ── NULL MEANS "NOT FORWARDED" ──────────────────────────────────────────────
-- Every existing row is NULL, and that is correct: nothing was ever forwarded
-- before this column existed. It is written only after the forward was
-- accepted by the mail server, so an SMTP outage leaves it NULL and the next
-- retry tries the forward again rather than losing the alert.
--
-- It is never cleared. A later successful retry imports normally and leaves
-- the record of the earlier alert in place.
ALTER TABLE "imported_email"
    ADD COLUMN "failure_forwarded_at" TIMESTAMPTZ(6);
