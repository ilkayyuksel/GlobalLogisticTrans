import { WinstonModuleOptions } from "nest-winston";
import { format, transports } from "winston";

import {
  EnvironmentVariables,
  LogLevel,
  NodeEnvironment,
} from "../config/environment.variables";

/**
 * Builds the Winston options for the current environment.
 *
 * Two deliberately different shapes:
 *   development — colourised single lines, optimised for a human reading a terminal
 *   production  — JSON, so a log collector can index the fields
 *
 * Kept as a pure function so it can be unit-tested without booting Nest.
 */

const SERVICE_NAME = "tms-backend";

function buildDevelopmentFormat() {
  return format.combine(
    format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
    format.errors({ stack: true }),
    format.colorize({ all: false }),
    format.printf(({ timestamp, level, message, context, stack, ...meta }) => {
      const scope = typeof context === "string" ? `[${context}] ` : "";
      const extra =
        Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
      const trace = typeof stack === "string" ? `\n${stack}` : "";

      return `${String(timestamp)} ${level} ${scope}${String(message)}${extra}${trace}`;
    }),
  );
}

function buildProductionFormat() {
  return format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.json(),
  );
}

/**
 * Only the two variables logging actually reads.
 *
 * Narrower than the whole environment on purpose: the caller has to hand over
 * exactly what is used, so adding an unrelated variable — a storage directory,
 * a queue URL — cannot break this factory.
 */
export type LoggingEnvironment = Pick<
  EnvironmentVariables,
  "NODE_ENV" | "LOG_LEVEL"
>;

export function buildWinstonOptions(
  environment: LoggingEnvironment,
): WinstonModuleOptions {
  const isProduction = environment.NODE_ENV === NodeEnvironment.Production;

  return {
    level: environment.LOG_LEVEL,
    defaultMeta: { service: SERVICE_NAME },
    format: isProduction ? buildProductionFormat() : buildDevelopmentFormat(),
    transports: [
      new transports.Console({
        // Tests are noisy enough without log output.
        silent: environment.NODE_ENV === NodeEnvironment.Test,
      }),
    ],
  };
}

export { LogLevel };
