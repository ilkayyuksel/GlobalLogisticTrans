-- A note is its text and nothing else: the title and colour columns go.
--
-- No code has ever written a note, so the table is expected to be empty. Should a
-- row exist anyway, its title is kept as the first line of its text rather than
-- lost with the column.
UPDATE "note"
SET "content" = "title" || E'\n\n' || "content"
WHERE btrim("title") <> '';

-- AlterTable
ALTER TABLE "note" DROP COLUMN "color",
DROP COLUMN "title";
