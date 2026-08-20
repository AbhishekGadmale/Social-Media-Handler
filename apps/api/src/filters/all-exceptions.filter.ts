/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { generateId } from '@agency-os/database';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

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

    // In a real app we might grab a trace ID from OpenTelemetry
    const requestId =
      (request.headers['x-request-id'] as string) || generateId();

    response.status(status).json({
      error: {
        code: errorCode,
        message: Array.isArray(message) ? message.join(', ') : message,
        requestId,
      },
    });
  }
}
