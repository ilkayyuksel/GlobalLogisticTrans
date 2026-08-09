import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { Request, Response } from "express";

import { AppLoggerService } from "../../logger/app-logger.service";
import {
  ApiErrorDetail,
  ApiErrorResponse,
} from "../interfaces/api-response.interface";

/**
 * Converts every uncaught exception into the standard error envelope.
 *
 * Two rules drive the design:
 *   - nothing is ever swallowed: 5xx is logged with its stack, 4xx as a warning
 *   - internal details never reach the client; an unrecognised error becomes a
 *     generic 500 while the real cause goes to the log
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private static readonly UNKNOWN_ERROR_MESSAGE = "Internal server error";

  constructor(private readonly logger: AppLoggerService) {
    this.logger.setContext(AllExceptionsFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const httpContext = host.switchToHttp();
    const request = httpContext.getRequest<Request>();
    const response = httpContext.getResponse<Response>();

    const statusCode = this.resolveStatusCode(exception);
    const error = this.resolveErrorDetail(exception, statusCode);

    this.logException(exception, statusCode, request);

    const body: ApiErrorResponse = {
      success: false,
      statusCode,
      error,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    response.status(statusCode).json(body);
  }

  private resolveStatusCode(exception: unknown): number {
    return exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private resolveErrorDetail(
    exception: unknown,
    statusCode: number,
  ): ApiErrorDetail {
    const code = HttpStatus[statusCode] ?? "INTERNAL_SERVER_ERROR";

    if (!(exception instanceof HttpException)) {
      return { code, message: AllExceptionsFilter.UNKNOWN_ERROR_MESSAGE };
    }

    const payload = exception.getResponse();

    if (typeof payload === "string") {
      return { code, message: payload };
    }

    // ValidationPipe returns { message: string[], error, statusCode }; the array
    // is the field-level detail the client needs to correct its request.
    const record = payload as Record<string, unknown>;
    const message = record.message;

    if (Array.isArray(message)) {
      return { code, message: "Validation failed", details: message };
    }

    return {
      code,
      message: typeof message === "string" ? message : exception.message,
    };
  }

  private logException(
    exception: unknown,
    statusCode: number,
    request: Request,
  ): void {
    const summary = `${request.method} ${request.url} failed with ${statusCode}`;

    if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(summary, {
        stack: exception instanceof Error ? exception.stack : undefined,
      });
      return;
    }

    this.logger.warn(summary, {
      reason: exception instanceof Error ? exception.message : String(exception),
    });
  }
}
