import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Request, Response } from "express";
import { Observable, map } from "rxjs";

import { ApiSuccessResponse } from "../interfaces/api-response.interface";

/**
 * Wraps every successful controller result in the standard success envelope.
 *
 * Controllers stay free of envelope construction — they return plain data and
 * this interceptor gives it a consistent shape. Failures never reach here;
 * AllExceptionsFilter owns the error envelope.
 */
@Injectable()
export class ResponseInterceptor<TData>
  implements NestInterceptor<TData, ApiSuccessResponse<TData>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler<TData>,
  ): Observable<ApiSuccessResponse<TData>> {
    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<Request>();
    const response = httpContext.getResponse<Response>();

    return next.handle().pipe(
      map((data) => ({
        success: true as const,
        statusCode: response.statusCode,
        data,
        timestamp: new Date().toISOString(),
        path: request.url,
      })),
    );
  }
}
