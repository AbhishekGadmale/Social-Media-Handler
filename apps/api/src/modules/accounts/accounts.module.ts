import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AccountsController } from './accounts.controller';

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
})
export class AccountsModule {}
