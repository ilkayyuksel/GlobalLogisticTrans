-- A Trip is identified by its booking number AND its container number.
--
-- ── WHY THE IDENTITY IS A PAIR ──────────────────────────────────────────────
-- One booking can carry several containers, and each is its own transport. The
-- booking number alone therefore stopped being an identity: two orders under
-- ANR123456 for two different containers are two Trips, and refusing the second
-- as a duplicate lost real work.
--
-- ── WHY `NULLS NOT DISTINCT` ────────────────────────────────────────────────
-- Most Trips have NO container number, and that is correct: a COLLECTION fetches
-- an empty container that does not exist yet, so the document names none. In the
-- data at the time of writing, 18 of 21 Trips have none.
--
-- Under the SQL default, every NULL is distinct from every other, so a plain
-- unique index would enforce nothing at all for those Trips — two imports of the
-- same collection order would both be accepted. `NULLS NOT DISTINCT` makes
-- "absent" a value like any other, so (ANR123456, NULL) is ONE identity: the
-- CANCEL and the UPDATE of a collection find the same Trip instead of creating
-- a second one. Requires PostgreSQL 15 or later; this deployment is 17.
--
-- ── WHY IT IS PARTIAL ───────────────────────────────────────────────────────
-- A DELETED Trip releases its identity. Deletion is the documented remedy for a
-- Trip entered in error, and it would be no remedy if the booking could never be
-- re-entered afterwards. The index therefore covers only the statuses that
-- actually hold an identity, which is the same rule TripService enforces.
--
-- ── AUDITED BEFORE APPLYING ─────────────────────────────────────────────────
-- 21 Trips, 0 deleted. No duplicate (booking, container) pair, no null booking
-- number, no booking carrying more than one container. Nothing is merged,
-- deleted or rewritten by this migration.

-- CreateIndex
CREATE UNIQUE INDEX "trip_identity_key"
  ON "trip" ("booking_number", "container_number")
  NULLS NOT DISTINCT
  WHERE "status" <> 'DELETED';
