import "dotenv/config";
import { defineConfig, env } from "prisma/config";

/**
 * Prisma CLI configuration.
 *
 * Prisma 7 removed the `url` property from the `datasource` block in
 * schema.prisma. The connection URL for the CLI and for Migrate now lives here.
 *
 * The URL itself is never hardcoded — it is read from the DATABASE_URL
 * environment variable, per architectural_rules.md §11 (Configuration) and
 * coding_standards.md (Environment Variables).
 *
 * Note: this file configures the CLI only. At runtime, PrismaClient is given a
 * driver adapter by the Backend; it does not read this file.
 *
 * ---------------------------------------------------------------------------
 * Prisma Client generation after a migration
 *
 * `prisma migrate dev` does NOT regenerate Prisma Client in 7.9.1, even though
 * its own `--help` still says it "trigger[s] generators (e.g. Prisma Client)"
 * and the `--skip-generate` flag that existed in v6 has been removed.
 *
 * Verified against a scratch database: three migrations were applied and the
 * generated client was left untouched. `prisma generate` regenerates it
 * correctly, so this is CLI behaviour, not a pnpm or workspace problem.
 *
 * There is no hook for it here — PrismaConfig exposes no generator or
 * post-migrate lifecycle option. The project therefore chains the two commands
 * in package.json:
 *
 *     db:migrate  ->  prisma migrate dev && prisma generate
 *     db:reset    ->  prisma migrate reset && prisma generate
 *
 * Always migrate through `pnpm db:migrate`. Calling `prisma migrate dev`
 * directly leaves the client stale, which surfaces as a model being undefined
 * at runtime rather than as a compile error.
 * ---------------------------------------------------------------------------
 */
export default defineConfig({
  schema: "prisma/schema.prisma",

  migrations: {
    path: "prisma/migrations",
    // Command run by `prisma db seed`. In Prisma 7 this replaces the
    // "prisma": { "seed": ... } key that used to live in package.json.
    // Seeding is only ever triggered explicitly by that command.
    seed: "tsx prisma/seed.ts",
  },

  datasource: {
    url: env("DATABASE_URL"),
  },
});
