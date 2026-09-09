-- CreateEnum
CREATE TYPE "MediaAssetStatus" AS ENUM ('UPLOADING', 'PROCESSING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "MediaAsset" DROP COLUMN "status",
ADD COLUMN "status" "MediaAssetStatus" NOT NULL;
