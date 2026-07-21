ALTER TABLE "outbound_commands" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "outbound_commands_tenantId_idempotencyKey_key"
ON "outbound_commands"("tenantId", "idempotencyKey");
