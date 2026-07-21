-- Existing in-progress pairings predate the expiry column. Give them one final
-- bounded window so a deploy cannot leave unregistered sessions leased forever.
UPDATE "whatsapp_accounts"
SET "pairingExpiresAt" = CURRENT_TIMESTAMP + INTERVAL '5 minutes'
WHERE "pairingMode" IS NOT NULL
  AND "pairingExpiresAt" IS NULL;
