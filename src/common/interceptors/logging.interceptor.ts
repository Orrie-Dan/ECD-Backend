import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const { method, originalUrl } = request;
    const startedAt = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const response = http.getResponse<Response>();
          const durationMs = Date.now() - startedAt;
          this.logger.log(`${method} ${originalUrl} ${response.statusCode} +${durationMs}ms`);
        },
        error: (error: Error & { status?: number }) => {
          const durationMs = Date.now() - startedAt;
          const status = error.status ?? 500;
          this.logger.error(`${method} ${originalUrl} ${status} +${durationMs}ms`);
        },
      }),
    );
  }
}
