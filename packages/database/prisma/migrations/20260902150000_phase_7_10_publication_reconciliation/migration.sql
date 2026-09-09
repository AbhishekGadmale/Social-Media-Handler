-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN     "processingStartedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PostPlatformVariant" ADD COLUMN     "reconciledAt" TIMESTAMP(3),
ADD COLUMN     "reconciledBy" TEXT,
ADD COLUMN     "reconciliationReason" TEXT;

-- AlterTable
ALTER TABLE "SocialConnection" ADD COLUMN     "grantedScopes" TEXT[] DEFAULT ARRAY[]::TEXT[];
