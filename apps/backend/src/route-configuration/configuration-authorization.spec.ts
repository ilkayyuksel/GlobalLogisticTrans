import { INestApplication, VersioningType } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, Reflector } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { AccessTokenGuard } from "../auth/access-token.guard";
import { AccessTokenVerifier } from "../auth/access-token.verifier";
import { loadJose } from "../auth/load-jose";
import { IS_PUBLIC_ROUTE, Public } from "../auth/public.decorator";
import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { ResponseInterceptor } from "../common/interceptors/response.interceptor";
import { AppLoggerService } from "../logger/app-logger.service";
import { SettingsController } from "../settings/settings.controller";
import { SettingsService } from "../settings/settings.service";
import { RouteConfigurationController } from "./route-configuration.controller";
import { RouteConfigurationService } from "./route-configuration.service";

/**
 * Nobody changes what a Trip costs without being logged in.
 *
 * ── WHY THIS DESERVES A SUITE OF ITS OWN ────────────────────────────────────
 * Pricing configuration is the highest-value write in the product: the fuel
 * percentage and the route prices decide what every Trip closed afterwards is
 * charged. Protection here is not a property of these controllers — it comes
 * from the application's GLOBAL guard, which is exactly why it is worth an
 * explicit test. A guard applied by default is also a guard that can be
 * removed by default, and nothing in either controller would fail if it were.
 *
 * ── THE FAILURE THIS CATCHES ────────────────────────────────────────────────
 * `@Public()` marks a route as open. Adding one to a pricing route — by
 * copying a health endpoint, say — would leave every test in the project
 * passing while the route prices became world-writable. These tests would not.
 *
 * ── HOW IT IS TESTED ────────────────────────────────────────────────────────
 * The convention `access-token.guard.spec.ts` already sets, unchanged: a REAL
 * `AccessTokenGuard` registered as `APP_GUARD`, real RS256 tokens signed with a
 * generated key pair, and the matching JWKS served through a stubbed `fetch`.
 * Nothing about the verification is mocked, and no new authorization mechanism
 * is introduced — this suite only mounts the two configuration controllers
 * behind the guard the application already uses.
 *
 * The SERVICES are doubles. What is under test is who may reach them, not what
 * they do; their behaviour is covered by their own suites.
 * ────────────────────────────────────────────────────────────────────────────
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

const ROUTE_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

const CONFIGURATION = {
  id: ROUTE_ID,
  departure: "Quay 869",
  destination: "Dourges",
  tarief: "520.00",
  toll: "18.00",
  tunnel: "0.00",
  hasToll: true,
  hasTunnel: true,
  isActive: true,
};

const SAVE_BODY = {
  departure: "Quay 869",
  destination: "Dourges",
  tarief: 550,
  toll: 25,
  tunnel: 5,
};

describe("pricing configuration is protected", () => {
  let application: INestApplication;
  let jose: JoseSigning;
  let signingKey: unknown;
  let keyId: string;

  let routeConfiguration: {
    findAll: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    changeState: jest.Mock;
  };
  let settings: { findAll: jest.Mock; update: jest.Mock };

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

    global.fetch = jest.fn(
      async () =>
        new Response(
          JSON.stringify({
            keys: [{ ...jwk, kid: keyId, alg: "RS256", use: "sig" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ) as unknown as typeof fetch;
  }

  async function signToken(): Promise<string> {
    return new jose.SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: keyId })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject(ADMIN_SUBJECT)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(signingKey);
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

  beforeEach(async () => {
    routeConfiguration = {
      findAll: jest.fn().mockResolvedValue([CONFIGURATION]),
      create: jest.fn().mockResolvedValue(CONFIGURATION),
      update: jest.fn().mockResolvedValue(CONFIGURATION),
      changeState: jest.fn().mockResolvedValue(CONFIGURATION),
    };
    settings = {
      findAll: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({
        id: "setting-fuel",
        category: "PRICING",
        key: "FUEL_PERCENTAGE",
        value: "20",
        valueType: "DECIMAL",
        description: null,
      }),
    };

    const configuration: Record<string, unknown> = {
      ENABLE_AUTH: true,
      AUTH0_DOMAIN: DOMAIN,
      AUTH0_AUDIENCE: AUDIENCE,
      AUTH0_ALLOWED_SUBJECTS: [],
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [RouteConfigurationController, SettingsController],
      providers: [
        Reflector,
        AccessTokenVerifier,
        {
          provide: RouteConfigurationService,
          useValue: routeConfiguration,
        },
        { provide: SettingsService, useValue: settings },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => configuration[key] },
        },
        { provide: AppLoggerService, useValue: logger },
        // The application's own guard, registered the way the application
        // registers it. Nothing here is a stand-in for authorization.
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
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await application?.close();
  });

  /** Every write that changes what a Trip will be charged. */
  const PRICING_WRITES: readonly [string, string, string, object][] = [
    [
      "the fuel percentage",
      "patch",
      "/api/v1/settings/PRICING/FUEL_PERCENTAGE",
      { value: "20" },
    ],
    [
      "a route's Tarief, Toll and Tunnel",
      "put",
      `/api/v1/route-configuration/${ROUTE_ID}`,
      SAVE_BODY,
    ],
    [
      "a new route configuration",
      "post",
      "/api/v1/route-configuration",
      SAVE_BODY,
    ],
    [
      "a route's activation",
      "patch",
      `/api/v1/route-configuration/${ROUTE_ID}/state`,
      { isActive: false },
    ],
  ];

  describe("without a token", () => {
    it.each(PRICING_WRITES)(
      "refuses to change %s",
      async (_what, method, path, body) => {
        const response = await (
          request(application.getHttpServer()) as unknown as Record<
            string,
            (url: string) => request.Test
          >
        )[method](path)
          .send(body)
          .expect(401);

        expect(response.body.error.message).toBe(
          "A valid access token is required.",
        );
      },
    );

    /**
     * The decisive assertion. A 401 proves the CALLER was refused; this proves
     * nothing reached the service behind it, which is what "the configuration
     * did not change" actually means.
     */
    it.each(PRICING_WRITES)(
      "reaches no service when refusing %s",
      async (_what, method, path, body) => {
        await (
          request(application.getHttpServer()) as unknown as Record<
            string,
            (url: string) => request.Test
          >
        )[method](path)
          .send(body)
          .expect(401);

        expect(settings.update).not.toHaveBeenCalled();
        expect(routeConfiguration.create).not.toHaveBeenCalled();
        expect(routeConfiguration.update).not.toHaveBeenCalled();
        expect(routeConfiguration.changeState).not.toHaveBeenCalled();
      },
    );

    /** Reading configuration is protected too: prices are commercial data. */
    it.each([
      ["the route configuration", "/api/v1/route-configuration"],
      ["the settings", "/api/v1/settings"],
    ])("refuses to read %s", async (_what, path) => {
      await request(application.getHttpServer()).get(path).expect(401);
    });

    it.each([
      ["Basic dXNlcjpwYXNz"],
      ["Bearer"],
      ["not-a-scheme token"],
    ])("refuses the malformed header %p", async (header) => {
      await request(application.getHttpServer())
        .put(`/api/v1/route-configuration/${ROUTE_ID}`)
        .set("Authorization", header)
        .send(SAVE_BODY)
        .expect(401);

      expect(routeConfiguration.update).not.toHaveBeenCalled();
    });

    /*
     * A token that verifies for a DIFFERENT API must not open this one. The
     * guard's own suite covers the full set of invalid tokens; this asserts the
     * pricing routes sit behind that same check rather than beside it.
     */
    it("refuses a token minted for another audience", async () => {
      const foreign = await new jose.SignJWT({})
        .setProtectedHeader({ alg: "RS256", kid: keyId })
        .setIssuer(ISSUER)
        .setAudience("https://api.somebody-else.test")
        .setSubject(ADMIN_SUBJECT)
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(signingKey);

      await request(application.getHttpServer())
        .patch("/api/v1/settings/PRICING/FUEL_PERCENTAGE")
        .set("Authorization", `Bearer ${foreign}`)
        .send({ value: "20" })
        .expect(401);

      expect(settings.update).not.toHaveBeenCalled();
    });
  });

  /**
   * ── AND THE AUTHENTICATED PATH STILL WORKS ────────────────────────────────
   * A guard that refused everything would pass every test above. These are what
   * make the refusals mean something.
   */
  describe("with a valid token", () => {
    it("changes the fuel percentage", async () => {
      const response = await request(application.getHttpServer())
        .patch("/api/v1/settings/PRICING/FUEL_PERCENTAGE")
        .set("Authorization", `Bearer ${await signToken()}`)
        .send({ value: "20" })
        .expect(200);

      expect(settings.update).toHaveBeenCalledWith(
        "PRICING",
        "FUEL_PERCENTAGE",
        { value: "20" },
      );
      expect(response.body.data.value).toBe("20");
    });

    it("changes a route's Tarief, Toll and Tunnel", async () => {
      const response = await request(application.getHttpServer())
        .put(`/api/v1/route-configuration/${ROUTE_ID}`)
        .set("Authorization", `Bearer ${await signToken()}`)
        .send(SAVE_BODY)
        .expect(200);

      expect(routeConfiguration.update).toHaveBeenCalledWith(
        ROUTE_ID,
        expect.objectContaining({ tarief: 550, toll: 25, tunnel: 5 }),
      );
      expect(response.body.data.id).toBe(ROUTE_ID);
    });

    it("creates a route configuration", async () => {
      await request(application.getHttpServer())
        .post("/api/v1/route-configuration")
        .set("Authorization", `Bearer ${await signToken()}`)
        .send(SAVE_BODY)
        .expect(201);

      expect(routeConfiguration.create).toHaveBeenCalledTimes(1);
    });

    it("deactivates a route", async () => {
      await request(application.getHttpServer())
        .patch(`/api/v1/route-configuration/${ROUTE_ID}/state`)
        .set("Authorization", `Bearer ${await signToken()}`)
        .send({ isActive: false })
        .expect(200);

      expect(routeConfiguration.changeState).toHaveBeenCalledWith(ROUTE_ID, {
        isActive: false,
      });
    });

    it("reads the route configuration", async () => {
      const response = await request(application.getHttpServer())
        .get("/api/v1/route-configuration")
        .set("Authorization", `Bearer ${await signToken()}`)
        .expect(200);

      expect(response.body.data).toHaveLength(1);
    });
  });

  /**
   * ── NO PRICING ROUTE MAY BE PUBLIC ────────────────────────────────────────
   * Asserted against the metadata rather than only through a request, because
   * this is the mistake that would otherwise pass silently: `@Public()` on one
   * of these handlers would make it world-writable while every other test in
   * the project still passed.
   */
  it("marks no configuration route as public", () => {
    const handlers = [
      ...Object.getOwnPropertyNames(RouteConfigurationController.prototype),
      ...Object.getOwnPropertyNames(SettingsController.prototype),
    ];

    for (const controller of [
      RouteConfigurationController,
      SettingsController,
    ]) {
      for (const name of Object.getOwnPropertyNames(controller.prototype)) {
        if (name === "constructor") {
          continue;
        }

        const handler = (
          controller.prototype as unknown as Record<string, object>
        )[name];

        expect(Reflect.getMetadata(IS_PUBLIC_ROUTE, handler)).toBeFalsy();
      }

      expect(Reflect.getMetadata(IS_PUBLIC_ROUTE, controller)).toBeFalsy();
    }

    // A guard against the test itself silently checking nothing.
    expect(handlers.length).toBeGreaterThan(2);
  });

  /**
   * And a control, because the assertion above is only worth as much as its
   * ability to FAIL.
   *
   * `IS_PUBLIC_ROUTE` is the key the guard actually reads — an earlier draft of
   * this suite guessed "isPublic" and passed while checking nothing at all.
   * This proves the same read detects a route that really is public.
   */
  it("would detect a public route if one were added", () => {
    class Control {
      @Public()
      open(): void {}

      closed(): void {}
    }

    expect(
      Reflect.getMetadata(IS_PUBLIC_ROUTE, Control.prototype.open),
    ).toBe(true);
    expect(
      Reflect.getMetadata(IS_PUBLIC_ROUTE, Control.prototype.closed),
    ).toBeFalsy();
  });
});
