import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module';
import { BillingModule } from '../billing/billing.module';
import { ReportsController } from './controllers/reports.controller';
import { ReportsService } from './services/reports.service';
import { ReportPdfService } from './services/report-pdf.service';

@Module({
  imports: [CoreModule, BillingModule],
  controllers: [ReportsController],
  providers: [ReportsService, ReportPdfService],
  exports: [ReportsService, ReportPdfService],
})
export class ReportsModule {}
