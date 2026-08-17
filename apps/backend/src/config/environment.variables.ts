import { Transform, plainToInstance } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  Min,
  ValidateIf,
  validateSync,
} from "class-validator";

/**
 * Validated shape of the environment.
 *
 * The application refuses to start when the environment is invalid. Failing at
 * boot is far cheaper than discovering a missing DATABASE_URL on the first
 * request, and it satisfies the rule that environment variables are untrusted
 * external input like any other.
 */

export enum NodeEnvironment {
  Development = "development",
  Production = "production",
  Test = "test",
}

export enum LogLevel {
  Error = "error",
  Warn = "warn",
  Info = "info",
  Debug = "debug",
  Verbose = "verbose",
}

/** Wildcard reflects the request origin back — never acceptable in production. */
export const CORS_ALLOW_ALL = "*";

const DEFAULT_API_PORT = 3000;
const DEFAULT_CORS_ORIGINS = [CORS_ALLOW_ALL];

/**
 * Repository-relative default for imported PDFs. The directory is gitignored:
 * customer transport orders must never reach version control.
 */
const DEFAULT_PDF_STORAGE_DIR = "../../storage/pdf";

/**
 * Transport orders are a few pages of text with a logo. The real fixtures are
 * 55–65 KB, so ten megabytes is already two orders of magnitude of headroom.
 * The limit exists to bound how much an unauthenticated request can make the
 * backend hold in memory, and a generous one would not bound anything.
 */
const DEFAULT_PDF_UPLOAD_MAX_SIZE_MB = 10;

/**
 * `environment.md` names INBOX as the first folder example, and it is the only
 * folder every IMAP server is required to provide.
 */
const DEFAULT_IMAP_FOLDER = "INBOX";

/** `importRules.md`: a NEW email creates trips. Case-insensitive at match time. */
const DEFAULT_MAIL_SUBJECT_NEW = "NEW:";

/** Implicit TLS on 993 is the norm for IMAP and what every hosted mailbox uses. */
const DEFAULT_IMAP_PORT = 993;

/** Every five minutes: orders arrive a few times a day, not continuously. */
const DEFAULT_IMAP_POLL_CRON = "0 */5 * * * *";

/**
 * A variable present but empty (`API_PORT=`) is the normal state of a freshly
 * copied .env template. Treating that as "not supplied" lets the declared
 * default apply, instead of coercing "" into 0 and failing validation with a
 * confusing message.
 */
function isBlank(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim().length === 0)
  );
}

function parsePort({ value }: { value: unknown }): unknown {
  return isBlank(value) ? DEFAULT_API_PORT : Number(value);
}

function parseOriginList({ value }: { value: unknown }): unknown {
  if (isBlank(value)) {
    return DEFAULT_CORS_ORIGINS;
  }

  if (typeof value !== "string") {
    return value;
  }

  const origins = value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return origins.length > 0 ? origins : DEFAULT_CORS_ORIGINS;
}

/** Keeps blank-handling for plain enum variables in one place. */
function defaultWhenBlank<TValue>(defaultValue: TValue) {
  return ({ value }: { value: unknown }): unknown =>
    isBlank(value) ? defaultValue : value;
}

/**
 * Environment booleans arrive as strings. Only an explicit "true" enables a
 * feature: anything else — "false", "0", a typo — leaves it off, because a flag
 * that switches on by accident is worse than one that stays off.
 */
function parseBoolean(defaultValue: boolean) {
  return ({ value }: { value: unknown }): unknown => {
    if (isBlank(value)) {
      return defaultValue;
    }

    return typeof value === "string"
      ? value.trim().toLowerCase() === "true"
      : Boolean(value);
  };
}

function parsePositiveInteger(defaultValue: number) {
  return ({ value }: { value: unknown }): unknown =>
    isBlank(value) ? defaultValue : Number(value);
}

/**
 * Comma-separated sender addresses, lowercased so the allowlist comparison is
 * deterministic regardless of how the address was typed. Matching is exact:
 * domain-suffix matching would silently trust every address at a domain, which
 * no requirement asks for.
 */
function parseTrustedSenders({ value }: { value: unknown }): unknown {
  if (isBlank(value) || typeof value !== "string") {
    return [];
  }

  return value
    .split(",")
    .map((sender) => sender.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * The allowed administrator identifiers, comma-separated.
 *
 * Lowercased so that an email typed with capitals in the environment still
 * matches the claim Auth0 sends. Auth0 `sub` values are case-sensitive in
 * principle but are machine-generated in lowercase, so this is safe for both.
 */
function parseAllowedSubjects({ value }: { value: unknown }): unknown {
  if (isBlank(value) || typeof value !== "string") {
    return [];
  }

  return value
    .split(",")
    .map((subject) => subject.trim().toLowerCase())
    .filter(Boolean);
}

export class EnvironmentVariables {
  @Transform(defaultWhenBlank(NodeEnvironment.Development))
  @IsEnum(NodeEnvironment)
  NODE_ENV: NodeEnvironment = NodeEnvironment.Development;

  @Transform(parsePort)
  @IsInt()
  @Min(1)
  @Max(65535)
  API_PORT: number = DEFAULT_API_PORT;

  /** No default: the backend is useless without a database. */
  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @Transform(defaultWhenBlank(LogLevel.Info))
  @IsEnum(LogLevel)
  LOG_LEVEL: LogLevel = LogLevel.Info;

  /**
   * Whether the API requires an Auth0 access token.
   *
   * Defaults to ON. An API that protects itself only when someone remembers to
   * switch it on is not protected — the safe state has to be the default, and
   * turning it off has to be a deliberate, visible act.
   *
   * The switch exists for one honest reason: the Auth0 tenant is provisioned
   * separately from this codebase, and until it is, there is no issuer to
   * verify tokens against. Running with `ENABLE_AUTH=false` is a local
   * development state, never a deployed one.
   */
  @Transform(parseBoolean(true))
  @IsBoolean()
  ENABLE_AUTH: boolean = true;

  /**
   * The Auth0 tenant, e.g. `traxo.eu.auth0.com`.
   *
   * The issuer and the JWKS endpoint are both derived from it, so this one
   * value decides which authorization server is trusted. Required whenever
   * authentication is on: without it there is nothing to verify against, and
   * defaulting it would mean guessing whose tokens to trust.
   */
  @ValidateIf((environment: EnvironmentVariables) => environment.ENABLE_AUTH)
  @IsString()
  @IsNotEmpty()
  AUTH0_DOMAIN: string = "";

  /**
   * The API identifier configured in Auth0, e.g. `https://api.traxo.example`.
   *
   * Verified as the token's `aud`. Without it, an access token minted for a
   * completely different API in the same tenant would be accepted here, which
   * is the classic confused-deputy mistake.
   */
  @ValidateIf((environment: EnvironmentVariables) => environment.ENABLE_AUTH)
  @IsString()
  @IsNotEmpty()
  AUTH0_AUDIENCE: string = "";

  /**
   * The single administrator this V1 admits, by Auth0 `sub` or by email.
   *
   * Optional, and empty means "any user the tenant authenticates". That is a
   * sufficient answer while the tenant has exactly one user, which is the V1
   * arrangement. Filling it in narrows access without introducing roles, a
   * users table or an administration screen — none of which V1 has.
   *
   * It is an allowlist of identifiers, never of credentials: no password,
   * secret or token belongs in this variable.
   */
  @Transform(parseAllowedSubjects)
  @IsArray()
  @IsString({ each: true })
  AUTH0_ALLOWED_SUBJECTS: string[] = [];

  /**
   * Comma-separated list in the environment, normalised to an array here so
   * every consumer receives the same shape.
   */
  @Transform(parseOriginList)
  @IsArray()
  @IsString({ each: true })
  CORS_ORIGINS: string[] = DEFAULT_CORS_ORIGINS;

  /**
   * Where imported transport-order PDFs are kept.
   *
   * Defaults to the repository's gitignored `storage/pdf`, resolved from the
   * backend's working directory. Configurable because a deployed backend does
   * not run from the repository, and the files must outlive it.
   */
  @Transform(defaultWhenBlank(DEFAULT_PDF_STORAGE_DIR))
  @IsString()
  @IsNotEmpty()
  PDF_STORAGE_DIR: string = DEFAULT_PDF_STORAGE_DIR;

  /**
   * The largest transport-order PDF a manual upload may carry, in megabytes.
   *
   * Enforced while the request is still being read, so an oversized file is
   * refused before its bytes are held anywhere. Expressed in megabytes because
   * that is the unit the limit is reasoned about in; the byte arithmetic
   * happens once, where the limit is applied.
   */
  @Transform(parsePositiveInteger(DEFAULT_PDF_UPLOAD_MAX_SIZE_MB))
  @IsInt()
  @Min(1)
  @Max(100)
  PDF_UPLOAD_MAX_SIZE_MB: number = DEFAULT_PDF_UPLOAD_MAX_SIZE_MB;

  /**
   * Whether the mailbox is scanned at all.
   *
   * Off by default, and the switch that makes every IMAP setting below
   * conditional: a developer with no mailbox credentials must still be able to
   * start the backend, so nothing here is required until the feature is turned
   * on. When it IS on, the credentials are validated at boot rather than
   * discovered by a scan failing at three in the morning.
   */
  @Transform(parseBoolean(false))
  @IsBoolean()
  ENABLE_IMAP: boolean = false;

  @ValidateIf((environment: EnvironmentVariables) => environment.ENABLE_IMAP)
  @IsString()
  @IsNotEmpty()
  IMAP_HOST: string = "";

  @Transform(parsePositiveInteger(DEFAULT_IMAP_PORT))
  @IsInt()
  @Min(1)
  @Max(65535)
  IMAP_PORT: number = DEFAULT_IMAP_PORT;

  @ValidateIf((environment: EnvironmentVariables) => environment.ENABLE_IMAP)
  @IsString()
  @IsNotEmpty()
  IMAP_USERNAME: string = "";

  /**
   * Never logged, never returned by an endpoint, never stored in a Setting.
   * It exists only to authenticate one connection.
   */
  @ValidateIf((environment: EnvironmentVariables) => environment.ENABLE_IMAP)
  @IsString()
  @IsNotEmpty()
  IMAP_PASSWORD: string = "";

  @Transform(parseBoolean(true))
  @IsBoolean()
  IMAP_TLS: boolean = true;

  @Transform(defaultWhenBlank(DEFAULT_IMAP_FOLDER))
  @IsString()
  @IsNotEmpty()
  IMAP_FOLDER: string = DEFAULT_IMAP_FOLDER;

  /**
   * The senders whose transport orders may create Trips.
   *
   * Required when IMAP is on and deliberately has no default: an empty
   * allowlist would either trust nobody, making the feature look broken, or —
   * far worse — be read as "trust anyone", which would let any sender create
   * Trips by emailing a PDF.
   */
  @Transform(parseTrustedSenders)
  @ValidateIf((environment: EnvironmentVariables) => environment.ENABLE_IMAP)
  @IsArray()
  @IsEmail({}, { each: true })
  IMAP_TRUSTED_SENDERS: string[] = [];

  @Transform(defaultWhenBlank(DEFAULT_MAIL_SUBJECT_NEW))
  @IsString()
  @IsNotEmpty()
  MAIL_SUBJECT_NEW: string = DEFAULT_MAIL_SUBJECT_NEW;

  /** Six-field cron (seconds first), the form @nestjs/schedule accepts. */
  @Transform(defaultWhenBlank(DEFAULT_IMAP_POLL_CRON))
  @IsString()
  @IsNotEmpty()
  IMAP_POLL_CRON: string = DEFAULT_IMAP_POLL_CRON;
}

/**
 * Passed to ConfigModule.forRoot({ validate }).
 *
 * enableImplicitConversion is deliberately off: the explicit @Transform above
 * makes each conversion visible instead of relying on inference.
 */
export function validateEnvironment(
  configuration: Record<string, unknown>,
): EnvironmentVariables {
  const validatedConfiguration = plainToInstance(
    EnvironmentVariables,
    configuration,
    { exposeDefaultValues: true },
  );

  const errors = validateSync(validatedConfiguration, {
    skipMissingProperties: false,
    whitelist: false,
  });

  if (errors.length > 0) {
    const details = errors
      .map((error) => Object.values(error.constraints ?? {}).join(", "))
      .join("; ");

    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return validatedConfiguration;
}
