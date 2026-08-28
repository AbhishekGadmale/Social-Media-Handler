import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as _cookieParser from 'cookie-parser';
const cookieParser = _cookieParser.default || _cookieParser;
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';

import { Logger } from 'nestjs-pino';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
    allowedHeaders: ['Content-Type', 'Accept', 'x-csrf-token'],
  });

  // Security headers with Helmet
  const isProduction = process.env.NODE_ENV === 'production';
  app.use(
    helmet({
      // HSTS must be disabled in development to prevent browsers from forcing HTTPS on localhost,
      // which would break local development for both frontend and backend.
      hsts: isProduction
        ? { maxAge: 31536000, includeSubDomains: true }
        : false,

      // CSP is largely unnecessary for a JSON API, but we keep a permissive default
      // that allows the OAuth 302 redirects to function without interference.
      contentSecurityPolicy: isProduction ? undefined : false,
    }),
  );

  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(
    `Application is running on port: ${port} (` + (await app.getUrl()) + `)`,
  );
}
void bootstrap();
