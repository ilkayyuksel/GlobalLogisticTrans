import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(fileURLToPath(import.meta.url));

/**
 * The repository keeps ONE .env at its root, shared by every workspace app —
 * the backend loads it the same way. Next only looks in its own directory, so
 * without this the frontend would need a second copy of the API URL, and the
 * two would drift.
 *
 * Guarded because a deployed build has no .env file at all: there the variables
 * come from the environment itself, which is already loaded.
 */
const repositoryEnvFile = resolve(packageRoot, "../../.env");

if (existsSync(repositoryEnvFile)) {
  process.loadEnvFile(repositoryEnvFile);
}

/**
 * The frontend is a pure client of the backend API: it has no database, no
 * server-side business logic and no routes of its own beyond pages.
 *
 * `reactStrictMode` is on so double-invoked effects surface state bugs during
 * development rather than in production.
 *
 * `outputFileTracingRoot` is pinned to this package because Next otherwise
 * walks up looking for a lockfile and can settle on one outside the repository
 * entirely, which makes its file tracing wrong in a way nothing else reports.
 */
/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: packageRoot,
};

export default nextConfig;
