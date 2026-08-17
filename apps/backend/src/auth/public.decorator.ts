import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_ROUTE = "auth:isPublicRoute";

/**
 * Marks a route as reachable without an access token.
 *
 * Deliberately an opt-OUT rather than an opt-in: the guard is global, so a new
 * controller is protected the moment it is written and a developer has to state
 * in the code that something is public. The reverse arrangement — protect what
 * you remember to protect — is how endpoints end up open.
 *
 * There are exactly two legitimate uses in this system:
 *   - the health probe, which orchestrators call before anything is signed in;
 *   - the API documentation, which describes the API rather than exposing data.
 *
 * Nothing that reads or writes business data may carry this.
 */
export const Public = () => SetMetadata(IS_PUBLIC_ROUTE, true);
