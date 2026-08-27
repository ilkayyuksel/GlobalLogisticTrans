/**
 * Everything this service reads from its environment, validated once at boot.
 *
 * Four variables and no more. There is deliberately no configured phone number:
 * the account is whichever one scanned the QR, and the session on disk IS the
 * identity. A number in the environment would be a second, unenforced claim
 * about who this service is, and the two could disagree.
 */

/** Where Baileys keeps its session keys. A Docker volume in production. */
const DEFAULT_SESSION_DIR = "/app/session";
const DEFAULT_PORT = 3200;

/**
 * The shortest a service token may be.
 *
 * This token is the only thing between an internal caller and the ability to
 * send WhatsApp messages as the company, so a short one is refused outright
 * rather than warned about.
 */
const MINIMUM_TOKEN_LENGTH = 24;

export interface WhatsAppServiceConfig {
  readonly port: number;
  readonly sessionDirectory: string;
  /** Shared secret the backend presents. Never logged, never returned. */
  readonly serviceToken: string;
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

/**
 * Reads and validates the environment.
 *
 * Throws rather than defaulting where a wrong value would be dangerous. A
 * missing token in particular must stop the process: defaulting it would leave
 * an unauthenticated send endpoint running on the internal network, which is
 * exactly the failure this check exists to prevent.
 */
export function readConfig(
  environment: NodeJS.ProcessEnv = process.env,
): WhatsAppServiceConfig {
  const serviceToken = (environment.WHATSAPP_SERVICE_TOKEN ?? "").trim();

  if (serviceToken.length < MINIMUM_TOKEN_LENGTH) {
    throw new ConfigurationError(
      `WHATSAPP_SERVICE_TOKEN is required and must be at least ${MINIMUM_TOKEN_LENGTH} characters.`,
    );
  }

  return {
    port: readPort(environment.WHATSAPP_PORT),
    sessionDirectory: (
      environment.WHATSAPP_SESSION_DIR ?? DEFAULT_SESSION_DIR
    ).trim(),
    serviceToken,
  };
}

function readPort(value: string | undefined): number {
  if (value === undefined || value.trim() === "") {
    return DEFAULT_PORT;
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new ConfigurationError(`WHATSAPP_PORT is not a valid port: ${value}`);
  }

  return port;
}
