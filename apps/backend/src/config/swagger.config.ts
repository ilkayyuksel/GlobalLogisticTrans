import { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

/** Mounted outside the global prefix so the URL stays short and memorable. */
export const SWAGGER_PATH = "docs";

/**
 * Mounts the OpenAPI document.
 *
 * Kept out of main.ts so bootstrap stays readable, and called only for
 * non-production environments — an unauthenticated schema dump of every
 * endpoint is a reconnaissance aid once authentication exists.
 */
export function setupSwagger(application: INestApplication): void {
  const document = new DocumentBuilder()
    .setTitle("Transport Management System API")
    .setDescription(
      "Backend API for the Transport Management System. All business logic lives behind this API.",
    )
    .setVersion("0.1.0")
    /*
     * Every endpoint below needs an Auth0 access token. Declaring it here puts
     * an Authorize button in the UI, so the documentation can be exercised with
     * a real token instead of only read — and `persistAuthorization` keeps that
     * token across reloads.
     *
     * The scheme is documented, never a token: nothing here holds a credential.
     */
    .addBearerAuth(
      {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description:
          "An Auth0 access token minted for this API's audience. Obtain it through the TRAXO frontend; this backend issues none.",
      },
      "auth0",
    )
    .addSecurityRequirements("auth0")
    .build();

  SwaggerModule.setup(
    SWAGGER_PATH,
    application,
    SwaggerModule.createDocument(application, document),
    {
      swaggerOptions: { persistAuthorization: true },
    },
  );
}
