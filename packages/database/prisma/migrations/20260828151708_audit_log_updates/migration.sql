-- DropIndex
DROP INDEX "AuditLog_actorId_idx";

-- DropIndex
DROP INDEX "AuditLog_workspaceId_idx";

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "requestId" TEXT;

-- CreateIndex
CREATE INDEX "AuditLog_workspaceId_createdAt_idx" ON "AuditLog"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
