ALTER TABLE "webhook_endpoints"
ADD COLUMN "accountIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
