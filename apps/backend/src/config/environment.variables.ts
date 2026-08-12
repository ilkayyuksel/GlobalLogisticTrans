import { Transform, plainToInstance } from "class-transformer";
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  Min,
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
