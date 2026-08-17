import { Controller, Get, INestApplication, VersioningType } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, Reflector } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { ResponseInterceptor } from "../common/interceptors/response.interceptor";
import { AppLoggerService } from "../logger/app-logger.service";
import { AccessTokenGuard } from "./access-token.guard";
import { AccessTokenVerifier } from "./access-token.verifier";
import { loadJose } from "./load-jose";
import { Public } from "./public.decorator";

/**
 * The API's front door.
 *
 * These tests sign REAL RS256 tokens with a generated key pair and serve the
 * matching JWKS through a stubbed `fetch`, which is exactly what `jose` reaches
 * for. Nothing about the verification is mocked — signature, issuer, audience
 * and expiry are all genuinely checked. A test that stubbed the verifier would
 * prove only that the guard calls something.
 */

/**
 * The signing side of `jose`, loaded the way the code under test loads it.
 *
 * A static `import { SignJWT } from "jose"` cannot work here: the package is
 * ESM, the suite compiles to CommonJS, and Jest refuses the require. The
 * production path already solved this — see `load-jose.ts` — so the test uses
 * the same door rather than bending the test runner's configuration.
 */
type JoseSigning = {
  SignJWT: new (payload: Record<string, unknown>) => {
    setProtectedHeader(header: Record<string, unknown>): SignJWTChain;
  };
  exportJWK(key: unknown): Promise<Record<string, unknown>>;
  generateKeyPair(
    algorithm: string,
    options: { extractable: boolean },
  ): Promise<{ privateKey: unknown; publicKey: unknown }>;
};

interface SignJWTChain {
  setIssuer(issuer: string): SignJWTChain;
  setAudience(audience: string): SignJWTChain;
  setSubject(subject: string): SignJWTChain;
  setIssuedAt(): SignJWTChain;
  setExpirationTime(when: string): SignJWTChain;
  sign(key: unknown): Promise<string>;
}

const DOMAIN = "traxo-test.eu.auth0.com";
const ISSUER = `https://${DOMAIN}/`;
const AUDIENCE = "https://api.traxo.test";
const ADMIN_SUBJECT = "auth0|traxo-admin";

@Controller({ path: "protected", version: "1" })
class ProtectedController {
  @Get()
  read(): { reached: true } {
    return { reached: true };
  }

  @Get("open")
  @Public()
  open(): { reached: true } {
    return { reached: true };
  }
}

describe("AccessTokenGuard", () => {
  let application: INestApplication;
  let jose: JoseSigning;
  let signingKey: unknown;
  let keyId: string;

  const logger = {
    setContext: jest.fn(),
    warn: jest.fn(),
    log: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  /** The tenant's public keys, as Auth0 would publish them. */
  async function publishKeySet(publicKey: unknown): Promise<void> {
    const jwk = await jose.exportJWK(publicKey);

    global.fetch = jest.fn(async () =>
      new Response(JSON.stringify({ keys: [{ ...jwk, kid: keyId, alg: "RS256", use: "sig" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;
  }

  async function signToken(
    claims: Record<string, unknown> = {},
    overrides: { issuer?: string; audience?: string; expiresIn?: string } = {},
  ): Promise<string> {
    return (
      new jose.SignJWT({ ...claims }).setProtectedHeader({
        alg: "RS256",
        kid: keyId,
      })
    )
      .setIssuer(overrides.issuer ?? ISSUER)
      .setAudience(overrides.audience ?? AUDIENCE)
      .setSubject((claims.sub as string) ?? ADMIN_SUBJECT)
      .setIssuedAt()
      .setExpirationTime(overrides.expiresIn ?? "5m")
      .sign(signingKey);
  }

  async function startApplication(
    settings: Partial<{
      ENABLE_AUTH: boolean;
      AUTH0_ALLOWED_SUBJECTS: string[];
    }> = {},
  ): Promise<void> {
    const configuration: Record<string, unknown> = {
      ENABLE_AUTH: true,
      AUTH0_DOMAIN: DOMAIN,
      AUTH0_AUDIENCE: AUDIENCE,
      AUTH0_ALLOWED_SUBJECTS: [],
      ...settings,
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [ProtectedController],
      providers: [
        Reflector,
        AccessTokenVerifier,
        {
          provide: ConfigService,
          useValue: { get: (key: string) => configuration[key] },
        },
        { provide: AppLoggerService, useValue: logger },
        { provide: APP_GUARD, useClass: AccessTokenGuard },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
      ],
    }).compile();

    application = moduleRef.createNestApplication();
    application.setGlobalPrefix("api");
    application.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: "1",
    });

    await application.init();
  }

  beforeAll(async () => {
    jose = (await loadJose()) as unknown as JoseSigning;

    const { privateKey, publicKey } = await jose.generateKeyPair("RS256", {
      extractable: true,
    });

    signingKey = privateKey;
    keyId = "traxo-test-key";

    await publishKeySet(publicKey);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await application?.close();
  });

  describe("with authentication on", () => {
    beforeEach(() => startApplication());

    it("lets a valid token reach the controller", async () => {
      const response = await request(application.getHttpServer())
        .get("/api/v1/protected")
        .set("Authorization", `Bearer ${await signToken()}`)
        .expect(200);

      expect(response.body.data).toEqual({ reached: true });
    });

    it("accepts a lowercase bearer scheme, as RFC 7235 requires", async () => {
      await request(application.getHttpServer())
        .get("/api/v1/protected")
        .set("Authorization", `bearer ${await signToken()}`)
        .expect(200);
    });

    it("refuses a request with no token", async () => {
      const response = await request(application.getHttpServer())
        .get("/api/v1/protected")
        .expect(401);

      expect(response.body.error.message).toBe(
        "A valid access token is required.",
      );
    });

    it.each([
      ["Basic dXNlcjpwYXNz"],
      ["Bearer"],
      ["Bearer    "],
      ["not-a-scheme token"],
    ])("refuses the malformed header %p", async (header) => {
      await request(application.getHttpServer())
        .get("/api/v1/protected")
        .set("Authorization", header)
        .expect(401);
    });

    it("refuses a token that is not a JWT at all", async () => {
      await request(application.getHttpServer())
        .get("/api/v1/protected")
        .set("Authorization", "Bearer not.a.jwt")
        .expect(401);
    });

    /** The signature is what makes a token more than a claim. */
    it("refuses a token signed by a different key", async () => {
      const stranger = await jose.generateKeyPair("RS256", {
        extractable: true,
      });
      const forged = await (
        new jose.SignJWT({}).setProtectedHeader({
          alg: "RS256",
          kid: keyId,
        })
      )
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setSubject(ADMIN_SUBJECT)
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(stranger.privateKey);

      await request(application.getHttpServer())
        .get("/api/v1/protected")
        .set("Authorization", `Bearer ${forged}`)
        .expect(401);
    });

    /** Any Auth0 tenant can mint tokens; only ours may open this API. */
    it("refuses a token from another issuer", async () => {
      const token = await signToken({}, { issuer: "https://someone-else.auth0.com/" });

      await request(application.getHttpServer())
        .get("/api/v1/protected")
        .set("Authorization", `Bearer ${token}`)
        .expect(401);
    });

    /** Without this check, a token for any other API in the tenant would work. */
    it("refuses a token minted for another API", async () => {
      const token = await signToken({}, { audience: "https://another.api" });

      await request(application.getHttpServer())
        .get("/api/v1/protected")
        .set("Authorization", `Bearer ${token}`)
        .expect(401);
    });

    it("refuses an expired token", async () => {
      const token = await signToken({}, { expiresIn: "-1m" });

      await request(application.getHttpServer())
        .get("/api/v1/protected")
        .set("Authorization", `Bearer ${token}`)
        .expect(401);
    });

    /** Telling a forger which part to fix is the one thing 401 must not do. */
    it("words every refusal identically", async () => {
      const absent = await request(application.getHttpServer()).get(
        "/api/v1/protected",
      );

      const expired = await request(application.getHttpServer())
        .get("/api/v1/protected")
        .set("Authorization", `Bearer ${await signToken({}, { expiresIn: "-1m" })}`);

      expect(absent.body.error).toEqual(expired.body.error);
    });

    it("never writes the token into the log", async () => {
      const token = await signToken({}, { expiresIn: "-1m" });

      await request(application.getHttpServer())
        .get("/api/v1/protected")
        .set("Authorization", `Bearer ${token}`)
        .expect(401);

      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(token);
    });

    it("still serves a route marked public", async () => {
      await request(application.getHttpServer())
        .get("/api/v1/protected/open")
        .expect(200);
    });
  });

  describe("the single administrator", () => {
    it("admits any authenticated user when no allowlist is configured", async () => {
      await startApplication({ AUTH0_ALLOWED_SUBJECTS: [] });

      await request(application.getHttpServer())
        .get("/api/v1/protected")
        .set("Authorization", `Bearer ${await signToken({ sub: "auth0|anyone" })}`)
        .expect(200);
    });

    it("admits the configured subject", async () => {
      await startApplication({ AUTH0_ALLOWED_SUBJECTS: [ADMIN_SUBJECT] });

      await request(application.getHttpServer())
        .get("/api/v1/protected")
        .set("Authorization", `Bearer ${await signToken()}`)
        .expect(200);
    });

    /** Email, because that is the identifier an operator actually knows. */
    it("admits the configured email", async () => {
      await startApplication({
        AUTH0_ALLOWED_SUBJECTS: ["admin@traxo.test"],
      });

      const token = await signToken({
        sub: "auth0|someone",
        email: "Admin@Traxo.Test",
      });

      await request(application.getHttpServer())
        .get("/api/v1/protected")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
    });

    it("refuses a valid token from anyone else", async () => {
      await startApplication({ AUTH0_ALLOWED_SUBJECTS: [ADMIN_SUBJECT] });

      const token = await signToken({
        sub: "auth0|intruder",
        email: "intruder@example.com",
      });

      await request(application.getHttpServer())
        .get("/api/v1/protected")
        .set("Authorization", `Bearer ${token}`)
        .expect(401);
    });
  });

  /**
   * The escape hatch exists because the Auth0 tenant is provisioned separately
   * from this codebase. It is a local development state, and the test says so
   * by pinning that it takes an explicit `false` to reach it.
   */
  describe("with authentication off", () => {
    it("lets every request through", async () => {
      await startApplication({ ENABLE_AUTH: false });

      await request(application.getHttpServer())
        .get("/api/v1/protected")
        .expect(200);
    });
  });
});
