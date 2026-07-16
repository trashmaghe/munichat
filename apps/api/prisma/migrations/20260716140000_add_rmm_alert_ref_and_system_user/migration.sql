-- CreateTable
CREATE TABLE "RmmAlertRef" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "rmmAlertId" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RmmAlertRef_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RmmAlertRef_messageId_key" ON "RmmAlertRef"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "RmmAlertRef_rmmAlertId_key" ON "RmmAlertRef"("rmmAlertId");

-- AddForeignKey
ALTER TABLE "RmmAlertRef" ADD CONSTRAINT "RmmAlertRef_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed a fixed system/service user to author bot-generated messages (e.g.
-- Tactical RMM alerts). Its adObjectGuid deliberately doesn't match any real
-- AD object, so channel-sync.service.ts (which only ever inserts/deletes
-- ChannelMember rows keyed on AD memberOf groups) never touches it.
INSERT INTO "User" ("id", "adObjectGuid", "username", "displayName", "isActive", "tokenVersion")
VALUES (gen_random_uuid()::text, 'system-bot', 'rmm-bot', 'Tactical RMM', true, 0)
ON CONFLICT ("username") DO NOTHING;
