import {
  Controller,
  Get,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../../auth/guards/auth.guard';
import { WorkspaceGuard } from '../../auth/guards/workspace.guard';
import { PermissionGuard } from '../../auth/guards/permission.guard';
import { WorkspaceWritableGuard } from '../../billing/guards/workspace-writable.guard';
import { RequirePermission } from '../../auth/decorators/permission.decorator';
import { CurrentUser } from '../../auth/decorators/user.decorator';
import { ReportsService } from '../services/reports.service';
import { ReportPdfService } from '../services/report-pdf.service';
import { UpdateBrandingDto, ReportQueryDto } from '../dto/report.dto';
import { AuditService } from '../../core/audit.service';
import { AuditAction } from '@agency-os/database';

@Controller('v1/workspaces/:workspaceId/reports')
@UseGuards(AuthGuard, WorkspaceGuard, PermissionGuard)
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly pdfService: ReportPdfService,
    private readonly audit: AuditService,
  ) {}

  @Get('branding')
  @RequirePermission('workspace.view')
  async getBranding(@Param('workspaceId') workspaceId: string) {
    return this.reportsService.getBranding(workspaceId);
  }

  @Put('branding')
  @UseGuards(WorkspaceWritableGuard)
  @RequirePermission('branding.manage')
  async updateBranding(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: any,
    @Body() dto: UpdateBrandingDto,
  ) {
    return this.reportsService.updateBranding(workspaceId, user.id, dto);
  }

  @Get('client-report')
  @RequirePermission('reports.generate')
  async getClientReport(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: any,
    @Query() query: ReportQueryDto,
    @Res() res: Response,
  ) {
    const reportData = await this.reportsService.assembleReportData(
      workspaceId,
      query.from,
      query.to,
      query.socialAccountId,
    );

    const pdfBuffer = await this.pdfService.renderClientReportPdf(reportData);

    await this.audit.logAction({
      workspaceId,
      actorId: user.id,
      action: AuditAction.REPORT_GENERATED,
      targetType: 'WORKSPACE',
      targetId: workspaceId,
      metadata: {
        from: query.from,
        to: query.to,
        socialAccountId: query.socialAccountId ?? null,
      },
    });

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="client-report-${workspaceId}-${query.from}-${query.to}.pdf"`,
      'Content-Length': pdfBuffer.length.toString(),
    });

    res.end(pdfBuffer);
  }
}
