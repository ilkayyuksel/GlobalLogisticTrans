import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { AccessTokenGuard } from "./access-token.guard";
import { AccessTokenVerifier } from "./access-token.verifier";

/**
 * Auth0 access-token verification, applied to the whole API.
 *
 * Registered through APP_GUARD so that protection is a property of the
 * application rather than something each controller opts into. A module added
 * next year is protected without its author doing anything.
 *
 * Global because the guard is instantiated by the DI container at the
 * application level and must find its verifier without every feature module
 * importing this one.
 *
 * There is deliberately no controller here: this backend issues no tokens, has
 * no login endpoint and stores no identity. Auth0 does all three.
 */
@Global()
@Module({
  providers: [
    AccessTokenVerifier,
    {
      provide: APP_GUARD,
      useClass: AccessTokenGuard,
    },
  ],
  exports: [AccessTokenVerifier],
})
export class AuthModule {}
