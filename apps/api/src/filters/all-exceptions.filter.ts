import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Request, Response } from 'express';
import {
  getOrCreateCorrelationId,
  attachCorrelationIdToResponse,
} from '../modules/core/correlation-id.utils';
import { sanitizeRequestUrl } from '../modules/core/url-sanitizer.utils';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    @InjectPinoLogger(AllExceptionsFilter.name)
    private readonly logger: PinoLogger,
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Extract pre-assigned ID or validate incoming header, falling back to a fresh UUID
    const requestId = getOrCreateCorrelationId(request);

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

    attachCorrelationIdToResponse(response, requestId);

    const is5xx = status >= 500;
    if (is5xx) {
      const sanitizedPath = sanitizeRequestUrl(request.url);
      if (exception instanceof Error) {
        const errorMetadata: Record<string, any> = {
          err: exception,
          requestId,
          statusCode: status,
          path: sanitizedPath,
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
            path: sanitizedPath,
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
