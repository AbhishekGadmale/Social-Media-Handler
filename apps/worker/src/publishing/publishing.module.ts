import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PublishingDispatcher } from './publishing.dispatcher';
import { PublishingProcessor } from './publishing.processor';
import { TokenService } from './token.service';
import { ExecutionValidator } from './execution.validator';
import {
  ProviderRegistry,
  providerRegistry,
  S3ObjectStorage,
} from '@agency-os/providers';
import { PrismaClient } from '@agency-os/database';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'publish',
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: false,
      },
    }),
  ],
  providers: [
    PrismaClient,
    TokenService,
    ExecutionValidator,
    PublishingDispatcher,
    PublishingProcessor,
    { provide: ProviderRegistry, useValue: providerRegistry },
    {
      provide: 'IObjectStorage',
      useFactory: () => {
        return new S3ObjectStorage({
          region: process.env.OBJECT_STORAGE_REGION || 'us-east-1',
          bucket: process.env.OBJECT_STORAGE_BUCKET || 'agency-os-media',
          accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY_ID || 'minioadmin',
          secretAccessKey:
            process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY || 'minioadmin',
          endpoint: process.env.OBJECT_STORAGE_ENDPOINT, // e.g. http://127.0.0.1:9000
          forcePathStyle:
            process.env.OBJECT_STORAGE_FORCE_PATH_STYLE === 'true' || true,
        });
      },
    },
  ],
})
export class PublishingModule {}
