-- CreateEnum
CREATE TYPE "LinkPreviewStatus" AS ENUM ('READY', 'FAILED');

-- AlterTable
ALTER TABLE "LinkPreview" ADD COLUMN     "fetchedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "status" "LinkPreviewStatus" NOT NULL;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
