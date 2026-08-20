import type { Config } from "jest";
import nextJest from "next/jest.js";

/**
 * next/jest supplies the SWC transform Next already uses, so tests compile the
 * same JSX and TypeScript the application does without a second toolchain to
 * keep in step.
 */
const createJestConfig = nextJest({ dir: "./" });

/**
 * Well above what a render needs, and deliberately so.
 *
 * These suites mount whole pages and drive them through userEvent, and when the
 * full suite runs every worker competes for the same cores. Jest's five-second
 * default is then exceeded by a page that is working perfectly — the failure
 * moved between suites from run to run, which is the signature of contention
 * rather than of a defect. A generous ceiling makes a red suite mean something.
 */
const TEST_TIMEOUT_MS = 30_000;

const config: Config = {
  testEnvironment: "jsdom",
  testTimeout: TEST_TIMEOUT_MS,
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  testMatch: ["<rootDir>/src/**/*.spec.{ts,tsx}"],
};

/**
 * Images, per FILE rather than one shared stub.
 *
 * next/jest maps every image to the same mock and replaces the `transform`
 * wholesale, so both changes have to be applied to the config it produces
 * rather than to the one handed in. Without this the three TRAXO assets are
 * indistinguishable in a test — and "did this pick the white logo or the navy
 * one?" is exactly the question worth asking, since the two are identical in
 * markup and opposite on screen.
 */
const IMAGE_PATTERN = "^.+\\.(png|jpe?g|gif|webp|avif|ico|bmp|svg)$";

/** Exactly the keys next/jest installs, so they can be removed. */
const NEXT_IMAGE_MAPPER_KEYS = [
  "^.+\\.(png|jpg|jpeg|gif|webp|avif|ico|bmp)$",
  "^.+\\.(svg)$",
];

export default async function jestConfig(): Promise<Config> {
  const resolved = await createJestConfig(config)();

  for (const key of NEXT_IMAGE_MAPPER_KEYS) {
    delete (resolved.moduleNameMapper as Record<string, unknown>)?.[key];
  }

  resolved.transform = {
    [IMAGE_PATTERN]: "<rootDir>/src/test/image-transform.js",
    ...(resolved.transform ?? {}),
  };

  return resolved;
}
