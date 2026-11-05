-- AlterTable
ALTER TABLE "SocialConnection" ALTER COLUMN "encryptedAccessToken" DROP NOT NULL,
ALTER COLUMN "accessTokenIv" DROP NOT NULL,
ALTER COLUMN "accessTokenAuthTag" DROP NOT NULL;
