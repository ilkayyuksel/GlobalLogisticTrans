import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";

import { AppLoggerService } from "../logger/app-logger.service";
import type { EnvironmentVariables } from "../config/environment.variables";
import { AccessTokenVerifier } from "./access-token.verifier";
import { IS_PUBLIC_ROUTE } from "./public.decorator";

/** RFC 6750: the token is presented as `Authorization: Bearer <token>`. */
const BEARER_PREFIX = "bearer ";

/**
 * Every request needs a valid Auth0 access token.
 *
 * Registered globally through APP_GUARD, so protection is the default state of
 * every controller — including ones written after this file. Opting out is
 * explicit and visible: see `@Public()`.
 *
 * ── WHAT THIS GUARD DOES NOT DO ─────────────────────────────────────────────
 * It creates no session, no user record and no role. Auth0 owns identity; this
 * backend stores business data only. The verified claims are attached to the
 * request for logging and for the single-admin check, and nothing persists
 * them.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Every rejection is the same 401 with the same wording. Telling a caller
 * whether a token was expired, mis-audienced or simply absent tells an attacker
 * which part of a forgery to fix; the detail goes to the log instead, where the
 * operator can read it.
 */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  private readonly isEnabled: boolean;

  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: AccessTokenVerifier,
    private readonly logger: AppLoggerService,
    configService: ConfigService<EnvironmentVariables, true>,
  ) {
    this.logger.setContext(AccessTokenGuard.name);
    this.isEnabled = configService.get("ENABLE_AUTH", { infer: true });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.isEnabled) {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(
      IS_PUBLIC_ROUTE,
      [context.getHandler(), context.getClass()],
    );

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = readBearerToken(request.headers.authorization);

    if (!token) {
      this.reject(request, "No bearer token was presented");
    }

    try {
      const payload = await this.verifier.verify(token);

      if (!this.verifier.isAllowed(payload)) {
        // Authenticated by the tenant, but not the administrator this
        // deployment admits. Logged by subject, never by token.
        this.reject(request, `Subject is not allowed: ${payload.sub ?? "unknown"}`);
      }

      // Read further down only for logging and the allowlist. Nothing here is
      // stored, and no request may widen its own authority through it.
      request.auth = { subject: payload.sub ?? null };

      return true;
    } catch (error: unknown) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      this.reject(
        request,
        error instanceof Error ? error.message : "Token verification failed",
      );
    }
  }

  /**
   * One wording for every failure, and the reason in the log.
   *
   * `never` as the return type so the compiler knows the code after a call
   * cannot run — otherwise every call site would need its own `throw`.
   */
  private reject(request: Request, reason: string): never {
    this.logger.warn("Rejected an unauthenticated request", {
      method: request.method,
      // The path only. A query string can carry business values, and this line
      // is written for every failed request.
      path: request.path,
      reason,
    });

    throw new UnauthorizedException("A valid access token is required.");
  }
}

/**
 * The token out of an Authorization header, or null.
 *
 * The scheme is compared case-insensitively because RFC 7235 defines it as
 * case-insensitive, and clients do send `bearer`.
 */
function readBearerToken(header: string | undefined): string | null {
  if (!header || !header.toLowerCase().startsWith(BEARER_PREFIX)) {
    return null;
  }

  const token = header.slice(BEARER_PREFIX.length).trim();

  return token === "" ? null : token;
}
