-- Staging table for outbound media sends. Bytes live here instead of inside the
-- durable command payload so large attachments stay out of jsonb.
CREATE TABLE "whatsapp_media_uploads" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "mimetype" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "caption" TEXT,
    "voice" BOOLEAN NOT NULL DEFAULT false,
    "bytes" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_media_uploads_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "whatsapp_media_uploads_accountId_createdAt_idx" ON "whatsapp_media_uploads"("accountId", "createdAt");

ALTER TABLE "whatsapp_media_uploads"
    ADD CONSTRAINT "whatsapp_media_uploads_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "whatsapp_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
