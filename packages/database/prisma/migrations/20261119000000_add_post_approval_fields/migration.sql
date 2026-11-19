-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('NOT_SUBMITTED', 'PENDING', 'APPROVED', 'CHANGES_REQUESTED');

-- AlterTable
ALTER TABLE "Post" ADD COLUMN "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
ADD COLUMN "approvalRequestedById" UUID,
ADD COLUMN "approvalRequestedAt" TIMESTAMP(3),
ADD COLUMN "approvalDecidedById" UUID,
ADD COLUMN "approvalDecidedAt" TIMESTAMP(3),
ADD COLUMN "approvalComment" TEXT;
