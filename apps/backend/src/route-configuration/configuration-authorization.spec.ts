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
import { PricingBootstrapService } from "../settings/pricing-bootstrap.service";
import { SettingsController } from "../settings/settings.controller";
import { SettingsService } from "../settings/settings.service";
import { BulkRouteImportService } from "./bulk-route-import.service";
import { CombinationRouteConfigurationService } from "./combination-route-configuration.service";
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

const COMBINATION_GROUP_ID = "7d2b8c14-9f3a-4c5e-8b1d-2e3f4a5b6c7d";
const LEG_ID = "5a1f0c1e-2b3d-4e5f-8a9b-0c1d2e3f4a5b";

const CONFIGURATION = {
  id: ROUTE_ID,
  departure: "Quay 869",
  destination: "Dourges",
  tarief: "520.00",
  kilometres: "25.00",
  tunnel: "0.00",
  hasTunnel: true,
  type: "NORMAL",
  combinationGroupId: null,
};

/** One Combination, as the endpoint returns it: a group and its two legs. */
const COMBINATION = {
  id: COMBINATION_GROUP_ID,
  legs: [
    {
      ...CONFIGURATION,
      id: LEG_ID,
      type: "COMBINATION",
      combinationGroupId: COMBINATION_GROUP_ID,
    },
    {
      ...CONFIGURATION,
      id: "9c858901-8a57-4791-81fe-4c455b099bc9",
      departure: "Dourges",
      destination: "Quay 869",
      tarief: "480.00",
      type: "COMBINATION",
      combinationGroupId: COMBINATION_GROUP_ID,
    },
  ],
};

const SAVE_BODY = {
  departure: "Quay 869",
  destination: "Dourges",
  tarief: 550,
  kilometres: 25,
  tunnel: 5,
};

/** What a bulk import reports having created. */
const IMPORT_SUMMARY = {
  normalRoutes: 1,
  combinationGroups: 0,
  combinationLegs: 0,
  totalRoutes: 1,
};

const BULK_BODY = {
  routes: [
    {
      type: "NORMAL",
      departure: "Quay 869",
      destination: "Dourges",
      tarief: 550,
      kilometres: 25,
      tunnel: 5,
    },
  ],
};

const SAVE_COMBINATION_BODY = {
  legs: [
    SAVE_BODY,
    { departure: "Dourges", destination: "Quay 869", tarief: 480, kilometres: 25, tunnel: 0 },
  ],
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
    remove: jest.Mock;
    setReviewed: jest.Mock;
  };
  let combinationConfiguration: {
    findAll: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
    setReviewed: jest.Mock;
  };
  let bulkImport: { check: jest.Mock; import: jest.Mock };
  let settings: { findAll: jest.Mock; update: jest.Mock; upsert: jest.Mock };
  let bootstrap: { plan: jest.Mock; apply: jest.Mock };

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
      remove: jest.fn().mockResolvedValue(CONFIGURATION),
      setReviewed: jest.fn().mockResolvedValue(CONFIGURATION),
    };
    /*
     * The Combination routes are configuration writes of exactly the same value:
     * they decide what both legs of a Combination cost. Left open they would be
     * as damaging as an open route price, so they are held to the same rule here.
     */
    combinationConfiguration = {
      findAll: jest.fn().mockResolvedValue([COMBINATION]),
      create: jest.fn().mockResolvedValue(COMBINATION),
      update: jest.fn().mockResolvedValue(COMBINATION),
      remove: jest.fn().mockResolvedValue(COMBINATION),
      setReviewed: jest.fn().mockResolvedValue(COMBINATION),
    };
    /*
     * The bulk import is the single most valuable write on this controller: one
     * request configures every route the business prices against. Left open it
     * would be worse than an open single-route endpoint, not better, so it is held
     * to exactly the same rule here.
     */
    bulkImport = {
      check: jest.fn().mockResolvedValue({
        isValid: true,
        summary: IMPORT_SUMMARY,
        errors: [],
      }),
      import: jest.fn().mockResolvedValue(IMPORT_SUMMARY),
    };
    const savedSetting = {
      id: "setting-fuel",
      category: "PRICING",
      key: "FUEL_PERCENTAGE",
      value: "20",
      valueType: "DECIMAL",
      description: null,
    };

    settings = {
      findAll: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(savedSetting),
      upsert: jest.fn().mockResolvedValue(savedSetting),
    };

    const emptyPlan = {
      settings: [],
      missingCount: 0,
      creatableCount: 0,
      blockedCount: 0,
    };

    bootstrap = {
      plan: jest.fn().mockResolvedValue(emptyPlan),
      apply: jest.fn().mockResolvedValue(emptyPlan),
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
        {
          provide: CombinationRouteConfigurationService,
          useValue: combinationConfiguration,
        },
        { provide: BulkRouteImportService, useValue: bulkImport },
        { provide: SettingsService, useValue: settings },
        { provide: PricingBootstrapService, useValue: bootstrap },
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
      "a route's deletion",
      "delete",
      `/api/v1/route-configuration/${ROUTE_ID}`,
      // A DELETE carries no body.
      {},
    ],
    /*
     * Bootstrapping CREATES pricing settings on a database that has none, so it
     * is a configuration write like any other here — and the most valuable one
     * to leave open by accident, because it is the endpoint whose whole purpose
     * is to work on a system nobody has configured yet.
     */
    [
      "a setting that does not exist yet",
      "put",
      "/api/v1/settings/PRICING/FUEL_PERCENTAGE",
      { value: "20" },
    ],
    [
      "the whole pricing configuration at once",
      "post",
      "/api/v1/settings/pricing/bootstrap",
      {},
    ],
    [
      "a new Combination route configuration",
      "post",
      "/api/v1/route-configuration/combinations",
      SAVE_COMBINATION_BODY,
    ],
    [
      "both legs of a Combination route",
      "put",
      `/api/v1/route-configuration/combinations/${COMBINATION_GROUP_ID}`,
      SAVE_COMBINATION_BODY,
    ],
    [
      "a Combination route's deletion",
      "delete",
      `/api/v1/route-configuration/combinations/${COMBINATION_GROUP_ID}`,
      {},
    ],
    [
      "every route price at once through a bulk import",
      "post",
      "/api/v1/route-configuration/bulk",
      BULK_BODY,
    ],
    /*
     * The dry run writes nothing, and is still protected: it reads back which
     * routes are already configured, which is commercial information.
     */
    [
      "a bulk import dry run",
      "post",
      "/api/v1/route-configuration/bulk/check",
      BULK_BODY,
    ],
    /*
     * Administrative progress is still configuration: who has checked which
     * prices is nobody's business but the operator's, and the endpoint writes.
     */
    [
      "a route's review mark",
      "patch",
      `/api/v1/route-configuration/${ROUTE_ID}/review`,
      { reviewed: true },
    ],
    [
      "a Combination's review mark",
      "patch",
      `/api/v1/route-configuration/combinations/${COMBINATION_GROUP_ID}/review`,
      { reviewed: true },
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
        expect(settings.upsert).not.toHaveBeenCalled();
        expect(bootstrap.apply).not.toHaveBeenCalled();
        expect(routeConfiguration.create).not.toHaveBeenCalled();
        expect(routeConfiguration.update).not.toHaveBeenCalled();
        expect(routeConfiguration.remove).not.toHaveBeenCalled();
        expect(combinationConfiguration.create).not.toHaveBeenCalled();
        expect(combinationConfiguration.update).not.toHaveBeenCalled();
        expect(combinationConfiguration.remove).not.toHaveBeenCalled();
        expect(bulkImport.import).not.toHaveBeenCalled();
        expect(bulkImport.check).not.toHaveBeenCalled();
        expect(routeConfiguration.setReviewed).not.toHaveBeenCalled();
        expect(combinationConfiguration.setReviewed).not.toHaveBeenCalled();
      },
    );

    /** Reading configuration is protected too: prices are commercial data. */
    it.each([
      ["the route configuration", "/api/v1/route-configuration"],
      [
        "the Combination route configuration",
        "/api/v1/route-configuration/combinations",
      ],
      ["the settings", "/api/v1/settings"],
      ["what is missing from the pricing configuration", "/api/v1/settings/pricing/bootstrap"],
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

    it("changes a route's Tarief, KM and Tunnel", async () => {
      const response = await request(application.getHttpServer())
        .put(`/api/v1/route-configuration/${ROUTE_ID}`)
        .set("Authorization", `Bearer ${await signToken()}`)
        .send(SAVE_BODY)
        .expect(200);

      expect(routeConfiguration.update).toHaveBeenCalledWith(
        ROUTE_ID,
        expect.objectContaining({ tarief: 550, kilometres: 25, tunnel: 5 }),
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

    /** 200 with the removed configuration, the convention every DELETE follows. */
    it("deletes a route", async () => {
      const response = await request(application.getHttpServer())
        .delete(`/api/v1/route-configuration/${ROUTE_ID}`)
        .set("Authorization", `Bearer ${await signToken()}`)
        .expect(200);

      expect(routeConfiguration.remove).toHaveBeenCalledWith(ROUTE_ID);
      expect(response.body.data.id).toBe(ROUTE_ID);
    });

    it("reads the route configuration", async () => {
      const response = await request(application.getHttpServer())
        .get("/api/v1/route-configuration")
        .set("Authorization", `Bearer ${await signToken()}`)
        .expect(200);

      expect(response.body.data).toHaveLength(1);
    });

    it("creates a Combination route configuration", async () => {
      await request(application.getHttpServer())
        .post("/api/v1/route-configuration/combinations")
        .set("Authorization", `Bearer ${await signToken()}`)
        .send(SAVE_COMBINATION_BODY)
        .expect(201);

      expect(combinationConfiguration.create).toHaveBeenCalledWith(
        expect.objectContaining({ legs: expect.any(Array) }),
      );
    });

    it("changes both legs of a Combination route", async () => {
      await request(application.getHttpServer())
        .put(`/api/v1/route-configuration/combinations/${COMBINATION_GROUP_ID}`)
        .set("Authorization", `Bearer ${await signToken()}`)
        .send(SAVE_COMBINATION_BODY)
        .expect(200);

      expect(combinationConfiguration.update).toHaveBeenCalledWith(
        COMBINATION_GROUP_ID,
        expect.objectContaining({ legs: expect.any(Array) }),
      );
    });

    /** The GROUP is removed, never one leg: the id is the group's. */
    it("deletes a Combination route configuration", async () => {
      const response = await request(application.getHttpServer())
        .delete(
          `/api/v1/route-configuration/combinations/${COMBINATION_GROUP_ID}`,
        )
        .set("Authorization", `Bearer ${await signToken()}`)
        .expect(200);

      expect(combinationConfiguration.remove).toHaveBeenCalledWith(
        COMBINATION_GROUP_ID,
      );
      // Both legs come back, so a caller can say exactly what is gone.
      expect(response.body.data.legs).toHaveLength(2);
    });

    it("imports route prices in bulk", async () => {
      const response = await request(application.getHttpServer())
        .post("/api/v1/route-configuration/bulk")
        .set("Authorization", `Bearer ${await signToken()}`)
        .send(BULK_BODY)
        .expect(201);

      expect(bulkImport.import).toHaveBeenCalledWith(BULK_BODY);
      expect(response.body.data.totalRoutes).toBe(1);
    });

    /** A dry run answers with 200 and writes nothing: it is a question. */
    it("checks a bulk import without performing it", async () => {
      const response = await request(application.getHttpServer())
        .post("/api/v1/route-configuration/bulk/check")
        .set("Authorization", `Bearer ${await signToken()}`)
        .send(BULK_BODY)
        .expect(200);

      expect(bulkImport.check).toHaveBeenCalledWith(BULK_BODY);
      expect(bulkImport.import).not.toHaveBeenCalled();
      expect(response.body.data.isValid).toBe(true);
    });

    it("marks a route as checked", async () => {
      await request(application.getHttpServer())
        .patch(`/api/v1/route-configuration/${ROUTE_ID}/review`)
        .set("Authorization", `Bearer ${await signToken()}`)
        .send({ reviewed: true })
        .expect(200);

      expect(routeConfiguration.setReviewed).toHaveBeenCalledWith(
        ROUTE_ID,
        true,
      );
    });

    /** The GROUP's mark: a Combination is reviewed as one record. */
    it("marks a Combination as checked", async () => {
      await request(application.getHttpServer())
        .patch(
          `/api/v1/route-configuration/combinations/${COMBINATION_GROUP_ID}/review`,
        )
        .set("Authorization", `Bearer ${await signToken()}`)
        .send({ reviewed: true })
        .expect(200);

      expect(combinationConfiguration.setReviewed).toHaveBeenCalledWith(
        COMBINATION_GROUP_ID,
        true,
      );
    });

    it("reads the Combination route configuration with both legs", async () => {
      const response = await request(application.getHttpServer())
        .get("/api/v1/route-configuration/combinations")
        .set("Authorization", `Bearer ${await signToken()}`)
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].legs).toHaveLength(2);
    });

    it("sets a setting that has never been configured", async () => {
      await request(application.getHttpServer())
        .put("/api/v1/settings/PRICING/FUEL_PERCENTAGE")
        .set("Authorization", `Bearer ${await signToken()}`)
        .send({ value: "20" })
        .expect(200);

      expect(settings.upsert).toHaveBeenCalledWith(
        "PRICING",
        "FUEL_PERCENTAGE",
        { value: "20" },
      );
    });

    it("bootstraps the pricing configuration", async () => {
      await request(application.getHttpServer())
        .post("/api/v1/settings/pricing/bootstrap")
        .set("Authorization", `Bearer ${await signToken()}`)
        .expect(200);

      expect(bootstrap.apply).toHaveBeenCalledTimes(1);
    });

    it("reports what is missing without creating it", async () => {
      await request(application.getHttpServer())
        .get("/api/v1/settings/pricing/bootstrap")
        .set("Authorization", `Bearer ${await signToken()}`)
        .expect(200);

      expect(bootstrap.plan).toHaveBeenCalledTimes(1);
      expect(bootstrap.apply).not.toHaveBeenCalled();
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
