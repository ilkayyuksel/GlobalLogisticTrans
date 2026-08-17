import type { JWTPayload, JWTVerifyGetKey } from "jose";

/**
 * `jose`, loaded as the ES module it is.
 *
 * ── WHY THIS INDIRECTION EXISTS ─────────────────────────────────────────────
 * jose v6 ships ESM only, and this backend compiles to CommonJS. A plain
 * `import { jwtVerify } from "jose"` becomes `require("jose")`, which Node 22
 * happens to allow — but Jest's module registry does not, and the test suite
 * runs under `--experimental-vm-modules` where a real dynamic import is the one
 * thing that does work.
 *
 * `new Function` is what keeps the import an import: both TypeScript and
 * ts-jest rewrite a literal `import(...)` into `require(...)`, and a function
 * body is opaque to both. This is the same technique, for the same reason, as
 * `apps/parser/src/text/extract.ts` — deliberately the same shape so the next
 * person meets one pattern rather than two.
 *
 * The module is fetched once and reused; `import()` caches, and the promise is
 * held so concurrent requests share a single load.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Only the three functions this backend actually uses are typed here. The
 * `import type` above is erased at compile time and adds no require.
 */
export interface JoseModule {
  createRemoteJWKSet(url: URL): JWTVerifyGetKey;
  jwtVerify(
    token: string,
    key: JWTVerifyGetKey,
    options: { issuer: string; audience: string },
  ): Promise<{ payload: JWTPayload }>;
}

const importEsm = new Function("specifier", "return import(specifier);") as (
  specifier: string,
) => Promise<unknown>;

let pending: Promise<JoseModule> | null = null;

export function loadJose(): Promise<JoseModule> {
  pending ??= importEsm("jose") as Promise<JoseModule>;

  return pending;
}
