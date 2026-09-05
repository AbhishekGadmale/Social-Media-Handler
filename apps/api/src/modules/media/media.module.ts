import { Module } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { S3ObjectStorage } from '@agency-os/providers';

@Module({
  controllers: [MediaController],
  providers: [
    MediaService,
    {
      provide: 'IObjectStorage',
      useFactory: () => {
        return new S3ObjectStorage({
          region: process.env.OBJECT_STORAGE_REGION || 'us-east-1',
          bucket: process.env.OBJECT_STORAGE_BUCKET || 'agency-os-media',
          accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY_ID || 'minioadmin',
          secretAccessKey:
            process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY || 'minioadmin',
          endpoint: process.env.OBJECT_STORAGE_ENDPOINT, // e.g. http://minio:9000
          publicEndpoint: process.env.OBJECT_STORAGE_PUBLIC_ENDPOINT, // e.g. http://localhost:9000
          forcePathStyle:
            process.env.OBJECT_STORAGE_FORCE_PATH_STYLE === 'true',
        });
      },
    },
  ],
  exports: [MediaService, 'IObjectStorage'],
})
export class MediaModule {}
