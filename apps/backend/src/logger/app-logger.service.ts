import { Inject, Injectable, LoggerService, Scope } from "@nestjs/common";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";

/**
 * The single logging entry point for the application.
 *
 * Wrapping Winston rather than injecting it directly means callers depend on
 * this narrow interface, so the underlying logging library can be replaced
 * without touching call sites.
 *
 * Implements Nest's LoggerService so the same instance can also serve as the
 * framework logger via app.useLogger().
 *
 * TRANSIENT scope: each injecting class receives its own instance and can call
 * setContext() without affecting anyone else's log context.
 */
@Injectable({ scope: Scope.TRANSIENT })
export class AppLoggerService implements LoggerService {
  private context?: string;

  constructor(
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  setContext(context: string): void {
    this.context = context;
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.info(this.asMessage(message), this.asMeta(optionalParams));
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.error(this.asMessage(message), this.asMeta(optionalParams));
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.warn(this.asMessage(message), this.asMeta(optionalParams));
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.debug(this.asMessage(message), this.asMeta(optionalParams));
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.verbose(this.asMessage(message), this.asMeta(optionalParams));
  }

  private asMessage(message: unknown): string {
    return typeof message === "string" ? message : JSON.stringify(message);
  }

  /**
   * Nest passes a trailing context string on framework logs, and application
   * code passes a structured object. Both are normalised into Winston metadata
   * so the output shape stays consistent.
   */
  private asMeta(optionalParams: unknown[]): Record<string, unknown> {
    const meta: Record<string, unknown> = {};

    if (this.context) {
      meta.context = this.context;
    }

    for (const parameter of optionalParams) {
      if (typeof parameter === "string") {
        meta.context = parameter;
      } else if (parameter instanceof Error) {
        meta.stack = parameter.stack;
      } else if (parameter && typeof parameter === "object") {
        Object.assign(meta, parameter);
      }
    }

    return meta;
  }
}
