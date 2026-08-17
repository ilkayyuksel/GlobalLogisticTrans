import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
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
 *
 * The single exception is a file: a StreamableFile is returned as it is,
 * because a PDF wrapped in JSON is no longer a PDF.
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
      map((data) =>
        // A file is not data to be described — it IS the response. Wrapping a
        // PDF in a JSON envelope would corrupt it, so binary results pass
        // through untouched and every JSON result is enveloped as before.
        data instanceof StreamableFile
          ? (data as unknown as ApiSuccessResponse<TData>)
          : {
              success: true as const,
              statusCode: response.statusCode,
              data,
              timestamp: new Date().toISOString(),
              path: request.url,
            },
      ),
    );
  }
}
