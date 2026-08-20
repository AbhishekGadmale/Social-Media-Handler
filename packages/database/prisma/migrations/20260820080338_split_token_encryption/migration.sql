/*
  Warnings:

  - You are about to drop the column `authTag` on the `SocialConnection` table. All the data in the column will be lost.
  - You are about to drop the column `iv` on the `SocialConnection` table. All the data in the column will be lost.
  - Added the required column `accessTokenAuthTag` to the `SocialConnection` table without a default value. This is not possible if the table is not empty.
  - Added the required column `accessTokenIv` to the `SocialConnection` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "SocialConnection" DROP COLUMN "authTag",
DROP COLUMN "iv",
ADD COLUMN     "accessTokenAuthTag" TEXT NOT NULL,
ADD COLUMN     "accessTokenIv" TEXT NOT NULL,
ADD COLUMN     "refreshExpiresAt" TIMESTAMP(3),
ADD COLUMN     "refreshTokenAuthTag" TEXT,
ADD COLUMN     "refreshTokenIv" TEXT;
