import { Module } from '@nestjs/common';
import { MediaRecoveryService } from './media.recovery.service';
import { PrismaClient } from '@agency-os/database';
import { S3ObjectStorage } from '@agency-os/providers';

@Module({
  providers: [
    PrismaClient,
    MediaRecoveryService,
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
export class MediaWorkerModule {}
