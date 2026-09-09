-- AlterTable
ALTER TABLE "PostPlatformVariant" ADD COLUMN     "dispatchVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "providerProcessingState" TEXT;
