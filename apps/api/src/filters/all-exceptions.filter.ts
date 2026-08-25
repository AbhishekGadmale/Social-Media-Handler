import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { generateId } from '@agency-os/database';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // In a real app we might grab a trace ID from OpenTelemetry
    const requestId =
      (request.headers['x-request-id'] as string) || generateId();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const errorResponse =
      exception instanceof HttpException
        ? exception.getResponse()
        : { message: 'Internal server error' };

    const message =
      typeof errorResponse === 'string'
        ? errorResponse
        : (errorResponse as any).message || 'Internal server error';

    const errorCode =
      exception instanceof HttpException
        ? exception.name
        : 'InternalServerError';

    if (exception instanceof Error) {
      this.logger.error(`[${requestId}] ${exception.message}`, exception.stack);
      if ('code' in exception || 'meta' in exception) {
        this.logger.error(
          `[${requestId}] Additional Error Details: ${JSON.stringify({
            code: (exception as any).code,
            meta: (exception as any).meta,
          })}`,
        );
      }
    } else {
      this.logger.error(`[${requestId}] Unhandled exception:`, exception);
    }

    response.status(status).json({
      error: {
        code: errorCode,
        message: Array.isArray(message) ? message.join(', ') : message,
        requestId,
      },
    });
  }
}
