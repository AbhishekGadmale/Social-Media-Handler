import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from 'nestjs-pino';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);

  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'UNHANDLED REJECTION');
  });

  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'UNCAUGHT EXCEPTION');
  });

  await app.listen(process.env.PORT ?? 3002);
  logger.log('Worker startup completed');
}
void bootstrap();
