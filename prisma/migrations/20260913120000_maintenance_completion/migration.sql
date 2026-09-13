-- The history of a maintenance record's completed cycles.
--
-- Completing maintenance no longer means "create the next record". The SAME
-- `maintenance` row is planned again on the next date and returns to PLANNED;
-- what happened in the cycle that just ended is written here, one row per
-- completion, so the history survives the record's date being moved on.
--
-- ── APPEND-ONLY ────────────────────────────────────────────────────────────
-- A row is written once, in the transaction that re-plans its record, and is
-- never updated or deleted. There is no `updated_at` column, and the record it
-- belongs to cannot be deleted while it has history (ON DELETE RESTRICT) —
-- maintenance records are never deleted in the first place.
--
-- ── NO DATA IS TOUCHED ─────────────────────────────────────────────────────
-- A new, empty table. Every existing `maintenance` row keeps every value it
-- has; nothing is backfilled, because no completion was ever recorded.
--
-- ── REVERSIBLE ─────────────────────────────────────────────────────────────
--   DROP TABLE "maintenance_completion";
-- which loses the completions recorded since — correctly, a rollback that kept
-- them could not.

CREATE TABLE "maintenance_completion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "maintenance_id" UUID NOT NULL,
    "planned_date" DATE NOT NULL,
    "completed_on" DATE NOT NULL,
    "next_maintenance_date" DATE NOT NULL,
    "notes" TEXT,
    "maintenance_type" TEXT,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_completion_pkey" PRIMARY KEY ("id")
);

-- The details screen reads one record's history in order.
CREATE INDEX "maintenance_completion_maintenance_id_completed_on_idx" ON "maintenance_completion"("maintenance_id", "completed_on");

ALTER TABLE "maintenance_completion" ADD CONSTRAINT "maintenance_completion_maintenance_id_fkey" FOREIGN KEY ("maintenance_id") REFERENCES "maintenance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
