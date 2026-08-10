import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    if (status === HttpStatus.INTERNAL_SERVER_ERROR && exception instanceof Error) {
      this.logger.error(exception.message, exception.stack);
    }

    const isDev = process.env.NODE_ENV !== 'production';
    const message =
      exception instanceof HttpException
        ? this.extractMessage(exception)
        : isDev && exception instanceof Error
          ? exception.message
          : 'Internal server error';

    const extras =
      exception instanceof HttpException
        ? this.extractConflictExtras(exception)
        : {};

    response.status(status).json({
      success: false,
      statusCode: status,
      message,
      ...extras,
      timestamp: new Date().toISOString(),
    });
  }

  private extractMessage(exception: HttpException): string | string[] {
    const res = exception.getResponse();
    if (typeof res === 'string') {
      return res;
    }
    if (typeof res === 'object' && res !== null && 'message' in res) {
      return (res as { message: string | string[] }).message;
    }
    return exception.message;
  }

  /** Surface entity + currentVersion for optimistic-lock 409 responses. */
  private extractConflictExtras(
    exception: HttpException,
  ): { entity?: string; currentVersion?: number } {
    const res = exception.getResponse();
    if (typeof res !== 'object' || res === null) {
      return {};
    }
    const body = res as Record<string, unknown>;
    const extras: { entity?: string; currentVersion?: number } = {};
    if (typeof body.entity === 'string') {
      extras.entity = body.entity;
    }
    if (typeof body.currentVersion === 'number') {
      extras.currentVersion = body.currentVersion;
    }
    return extras;
  }
}
