-- Adds the driving licence number to Driver.
--
-- Nullable because a Driver may be registered before the licence details are
-- known (database_model.md §4.7, "Licence Number").

-- AlterTable
ALTER TABLE "driver" ADD COLUMN "licence_number" TEXT;

-- CreateIndex
-- Scoped to active Drivers, matching the pattern already used for vehicle and
-- trailer plates: a deactivated Driver keeps its historical value while the
-- number becomes reusable. NULLs are distinct in PostgreSQL, so any number of
-- Drivers may have no licence number.
CREATE UNIQUE INDEX "driver_licence_number_active_key"
    ON "driver" ("licence_number") WHERE "is_active";
