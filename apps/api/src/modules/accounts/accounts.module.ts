import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'sync',
      defaultJobOptions: {
        removeOnComplete: false,
        removeOnFail: false,
      },
    }),
  ],
  controllers: [AccountsController],
  providers: [AccountsService],
})
export class AccountsModule {}
