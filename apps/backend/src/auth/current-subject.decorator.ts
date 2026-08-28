import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

/**
 * Recorded instead of a subject when this deployment runs with ENABLE_AUTH off.
 *
 * Local development and the test environment have no Auth0 tenant, so no
 * subject exists to attribute a change to. Naming that state is honest;
 * inventing a person, or reusing SYSTEM_ACTOR — which means "a document that
 * arrived by itself" — would attribute the change to somebody who never made
 * it. A row carrying this value says exactly what happened: an operator acted
 * on a deployment that was not identifying anybody.
 */
export const UNAUTHENTICATED_ACTOR = "system:auth-disabled";

/**
 * The Auth0 subject of the caller, for a write that records WHO made it.
 *
 * ── WHY THIS IS A DECORATOR AND NOT A BODY FIELD ────────────────────────────
 * The author of a change must come from the verified token, never from the
 * request body. A browser that names the author of its own change can name
 * somebody else, which turns an audit trail into a suggestion. The guard has
 * already verified the token and attached the subject; this reads it back on
 * the server, where the caller cannot reach.
 */
export const CurrentSubject = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<Request>();

    return request.auth?.subject ?? UNAUTHENTICATED_ACTOR;
  },
);
