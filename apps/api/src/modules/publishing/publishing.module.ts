import { Module } from '@nestjs/common';
import { PostsController } from './controllers/posts.controller';
import { PublicationsController } from './controllers/publications.controller';
import { PublishingApplicationService } from './services/publishing-application.service';
import { PublishabilityValidator } from './domain/PublishabilityValidator';
import { CoreModule } from '../core/core.module';
import { PrismaClient } from '@agency-os/database';

@Module({
  imports: [CoreModule],
  controllers: [PostsController, PublicationsController],
  providers: [
    PublishingApplicationService,
    {
      provide: PublishabilityValidator,
      useFactory: (prisma: PrismaClient) => new PublishabilityValidator(prisma),
      inject: [PrismaClient],
    },
  ],
  exports: [PublishingApplicationService],
})
export class PublishingModule {}
