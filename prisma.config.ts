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
