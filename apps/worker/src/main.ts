import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('WorkerMain');

  process.on('unhandledRejection', (reason) => {
    logger.error('UNHANDLED REJECTION', reason);
  });

  process.on('uncaughtException', (err) => {
    logger.error('UNCAUGHT EXCEPTION', err);
  });

  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3002);
}
void bootstrap();
