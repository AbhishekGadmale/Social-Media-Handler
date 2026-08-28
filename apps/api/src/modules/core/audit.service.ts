import { Injectable, Logger } from '@nestjs/common';
import { AuditLogRepository, CreateAuditLogDto } from '@agency-os/database';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly auditRepo: AuditLogRepository) {}

  /**
   * Fire-and-forget persistent audit logging.
   * We do not await this in critical paths to avoid failing the business operation
   * if the audit log transiently fails, per MVP constraints.
   */
  logAction(data: CreateAuditLogDto): void {
    // We intentionally don't await to avoid coupling the latency or failure
    // of the audit insert to the critical path (like OAuth or Login).
    this.auditRepo.create(data).catch((error) => {
      // If audit logging fails, we log it to operational logs via Pino
      // so it isn't silently swallowed.
      this.logger.error(
        { err: error, auditData: data },
        `Failed to persist audit log: ${data.action}`,
      );
    });
  }
}
