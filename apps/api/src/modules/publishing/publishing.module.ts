import { Module } from '@nestjs/common';
import { PostsController } from './controllers/posts.controller';
import { PublicationsController } from './controllers/publications.controller';
import { PublishingApplicationService } from './services/publishing-application.service';
import { PublishabilityValidator } from './domain/PublishabilityValidator';
import { CoreModule } from '../core/core.module';
import { BillingModule } from '../billing/billing.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaClient } from '@agency-os/database';

@Module({
  imports: [CoreModule, BillingModule, AuthModule],
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
