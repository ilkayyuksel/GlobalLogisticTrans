import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { JWTPayload, JWTVerifyGetKey } from "jose";

import type { EnvironmentVariables } from "../config/environment.variables";
import { loadJose } from "./load-jose";

/**
 * Verifies Auth0 access tokens.
 *
 * ── WHY jose AND NOT PASSPORT ───────────────────────────────────────────────
 * This is the whole of the authentication code in the backend: fetch the
 * tenant's public keys, check the signature, check the issuer and the audience.
 * Passport would add a strategy, a module and two more packages to express the
 * same three checks, and none of the rest of Passport is wanted here — there
 * are no local users, no sessions and no login endpoint on this side.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * ── WHAT IS CHECKED, AND WHY EACH MATTERS ───────────────────────────────────
 * signature  the token really came from this tenant.
 * issuer     it came from OUR tenant, not from any Auth0 tenant on the internet.
 * audience   it was minted for THIS API. Without this check, a token issued to
 *            any other API in the same tenant would open this one.
 * expiry     jose enforces `exp` and `nbf` itself.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The key set is fetched lazily and cached by `jose`, which also handles key
 * rotation: an unknown `kid` triggers one refetch rather than a failure. So a
 * rotated signing key costs one extra request, not a restart.
 */
@Injectable()
export class AccessTokenVerifier {
  private readonly issuer: string;
  private readonly audience: string;
  private readonly allowedSubjects: readonly string[];

  /**
   * Built on first use rather than in the constructor.
   *
   * `createRemoteJWKSet` is cheap to construct but the class is instantiated
   * even when authentication is off, and a disabled system should make no
   * assumptions about a tenant it was never told about. It also lives behind an
   * ES-module load, which a constructor cannot await.
   */
  private keySet: JWTVerifyGetKey | null = null;

  constructor(
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {
    const domain = this.configService.get("AUTH0_DOMAIN", { infer: true });

    // Auth0 issues tokens with a trailing slash on the issuer. Matching it
    // exactly matters: a mismatch here rejects every genuine token.
    this.issuer = `https://${domain}/`;
    this.audience = this.configService.get("AUTH0_AUDIENCE", { infer: true });
    this.allowedSubjects = this.configService.get("AUTH0_ALLOWED_SUBJECTS", {
      infer: true,
    });
  }

  /** Throws whatever `jose` throws; the caller turns that into a 401. */
  async verify(token: string): Promise<JWTPayload> {
    const jose = await loadJose();

    this.keySet ??= jose.createRemoteJWKSet(
      new URL(`${this.issuer}.well-known/jwks.json`),
    );

    const { payload } = await jose.jwtVerify(token, this.keySet, {
      issuer: this.issuer,
      audience: this.audience,
    });

    return payload;
  }

  /**
   * Whether this verified token belongs to the administrator V1 admits.
   *
   * An empty allowlist admits any user the tenant authenticated, which is the
   * correct answer for a tenant holding exactly one user: the check would be
   * duplicating what Auth0 already decided. Once the list is filled in, both
   * the `sub` and the email claim are accepted, because which of the two an
   * operator has to hand differs — `sub` is exact, email is memorable.
   */
  isAllowed(payload: JWTPayload): boolean {
    if (this.allowedSubjects.length === 0) {
      return true;
    }

    const email = typeof payload.email === "string" ? payload.email : null;

    return [payload.sub, email]
      .filter((value): value is string => typeof value === "string")
      .some((value) => this.allowedSubjects.includes(value.toLowerCase()));
  }
}
