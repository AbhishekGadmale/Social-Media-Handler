import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Optional,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Request, Response } from 'express';
import { generateId } from '@agency-os/database';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger: PinoLogger;

  constructor(
    @Optional()
    @InjectPinoLogger(AllExceptionsFilter.name)
    logger?: PinoLogger,
  ) {
    this.logger = logger ?? new PinoLogger({});
    if (!logger) {
      this.logger.setContext(AllExceptionsFilter.name);
    }
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // In a real app we might grab a trace ID from OpenTelemetry
    const requestId =
      (request as any).id ||
      (request.headers['x-request-id'] as string) ||
      generateId();

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

    if (!response.headersSent && typeof response.setHeader === 'function') {
      response.setHeader('x-request-id', requestId);
    }

    const is5xx = status >= 500;
    if (is5xx) {
      if (exception instanceof Error) {
        const errorMetadata: Record<string, any> = {
          err: exception,
          requestId,
          statusCode: status,
          path: request.url,
          method: request.method,
        };
        if ('code' in exception) {
          errorMetadata.code = (exception as any).code;
        }
        if ('meta' in exception) {
          errorMetadata.meta = (exception as any).meta;
        }
        this.logger.error(errorMetadata, exception.message);
      } else {
        this.logger.error(
          {
            exception,
            requestId,
            statusCode: status,
            path: request.url,
            method: request.method,
          },
          'Unhandled exception',
        );
      }
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
