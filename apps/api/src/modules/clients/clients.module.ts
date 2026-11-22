import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { ClientsController } from './controllers/clients.controller';
import { ClientsService } from './services/clients.service';

@Module({
  imports: [CoreModule, AuthModule, BillingModule],
  controllers: [ClientsController],
  providers: [ClientsService],
  exports: [ClientsService],
})
export class ClientsModule {}
