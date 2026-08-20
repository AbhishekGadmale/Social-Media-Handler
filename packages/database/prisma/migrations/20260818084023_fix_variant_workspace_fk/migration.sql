-- AddForeignKey
ALTER TABLE "PostPlatformVariant" ADD CONSTRAINT "PostPlatformVariant_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
