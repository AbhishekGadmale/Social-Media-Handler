import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import * as _cookieParser from 'cookie-parser';
const cookieParser = _cookieParser.default || _cookieParser;
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';

import { Logger } from 'nestjs-pino';
import { configureTrustProxy } from './config/trust-proxy';
import { getPublicApiUrl } from './config/public-url';

async function bootstrap() {
  const isProduction = process.env.NODE_ENV === 'production';

  // Fail-fast startup validation for API_PUBLIC_URL in production
  getPublicApiUrl();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));

  // Configure Express Trust Proxy
  configureTrustProxy(app, process.env.TRUST_PROXY, isProduction);

  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
    allowedHeaders: ['Content-Type', 'Accept', 'x-csrf-token'],
  });

  // Security headers with Helmet
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
