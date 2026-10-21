import { Injectable, Logger } from '@nestjs/common';
import {
  AuditLogRepository,
  CreateAuditLogDto,
  Prisma,
} from '@agency-os/database';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly auditRepo: AuditLogRepository) {}

  /**
   * Reliable, awaitable audit logging for business mutations.
   * Awaits repository persistence and propagates rejections to the caller.
   */
  async logAction(
    data: CreateAuditLogDto,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    if (tx) {
      await this.auditRepo.create(data, tx);
    } else {
      await this.auditRepo.create(data);
    }
  }

  /**
   * Best-effort non-blocking audit logging for authentication and operational boundaries.
   * Catches errors internally and logs them via Pino without failing the caller.
   */
  logActionBestEffort(data: CreateAuditLogDto): void {
    this.logAction(data).catch((error) => {
      this.logger.error(
        { err: error, auditData: data },
        `Failed to persist audit log (best-effort): ${data.action}`,
      );
    });
  }
}
