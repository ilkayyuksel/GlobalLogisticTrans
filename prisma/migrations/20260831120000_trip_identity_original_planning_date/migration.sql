-- A Trip is identified by its booking number, its container number AND the
-- original transport date.
--
-- ── WHY THE DATE JOINS THE IDENTITY ─────────────────────────────────────────
-- The same booking and the same container legitimately come round again on a
-- later date: the same box, the same reference, a new transport a week later.
-- Under the two-column identity those were one Trip, so the second order could
-- not be imported at all — the import was refused as a duplicate and real work
-- was lost, which is the same failure the container number was added to fix.
--
-- ── WHY THE *ORIGINAL* DATE AND NOT `planning_date` ─────────────────────────
-- `planning_date` is the operator's: they re-plan a truck to another day and it
-- moves. An identity built on it would move with it, and a later UPDATE or
-- CANCEL naming the transport AS ORDERED could no longer find its Trip.
--
-- `original_planning_date` is what the document said — the `Date/time:` line of
-- its LOADING or DELIVERY section — and it never changes after the Trip is
-- created. That is precisely what an identity needs, so the constraint uses it
-- and the application compares incoming documents against it.
--
-- ── THE OTHER TWO RULES ARE UNCHANGED ───────────────────────────────────────
-- `NULLS NOT DISTINCT` still makes an absent value a value: most Trips carry no
-- container, and a manually created Trip may carry no original date, so under
-- the SQL default the index would enforce nothing for exactly the rows that
-- need it most. Requires PostgreSQL 15 or later; this deployment is 17.
--
-- The index is still partial on `status <> 'DELETED'`, because a deleted Trip
-- releases its identity — soft delete is the documented remedy for a Trip
-- entered in error, and it would be no remedy if the identity could never be
-- re-entered. TripService enforces the same rule in its own terms so a clash is
-- a domain refusal rather than a constraint violation surfacing as a 500.
--
-- ── AUDITED BEFORE APPLYING ─────────────────────────────────────────────────
-- Read-only audit of the live database, before this migration was written:
--
--   26 Trips (22 OPEN, 3 CLOSED, 1 CANCELLED), 0 DELETED
--   0 null booking numbers, 21 null container numbers, 0 null original dates
--   0 duplicate (booking, container) pairs            — the old identity holds
--   0 bookings carrying one container across two dates — nothing was suppressed
--   0 groups colliding under (booking, container, original_planning_date)
--   0 Trips where original_planning_date differs from planning_date
--
-- The new identity is therefore strictly WIDER than the old one on this data:
-- every row that was unique before remains unique, and no row becomes a
-- duplicate. Nothing is merged, deleted or rewritten by this migration — only
-- the index definition changes. Had there been a collision this migration would
-- not exist: merging Trips is a decision for a person, never for a migration.

-- DropIndex
DROP INDEX "trip_identity_key";

-- CreateIndex
CREATE UNIQUE INDEX "trip_identity_key"
  ON "trip" ("booking_number", "container_number", "original_planning_date")
  NULLS NOT DISTINCT
  WHERE "status" <> 'DELETED';
