-- Persist reconnect scheduling so failed WhatsApp sessions do not create a
-- tight retry loop across worker restarts or lease handoffs.
ALTER TABLE "whatsapp_accounts"
ADD COLUMN "lastConnectAttemptAt" TIMESTAMP(3),
ADD COLUMN "nextConnectAt" TIMESTAMP(3),
ADD COLUMN "reconnectAttempt" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "whatsapp_accounts_status_nextConnectAt_idx"
ON "whatsapp_accounts"("status", "nextConnectAt");
