-- CreateTable
CREATE TABLE "Client" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "brandDisplayName" TEXT,
    "brandLogoUrl" TEXT,
    "brandAccentColor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "SocialAccount" ADD COLUMN "clientId" UUID;

-- AlterTable
ALTER TABLE "WorkspaceMember" ADD COLUMN "clientId" UUID;

-- AlterTable
ALTER TABLE "WorkspaceInvitation" ADD COLUMN "clientId" UUID;

-- CreateIndex
CREATE INDEX "Client_workspaceId_idx" ON "Client"("workspaceId");

-- CreateIndex
CREATE INDEX "SocialAccount_workspaceId_clientId_idx" ON "SocialAccount"("workspaceId", "clientId");

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
