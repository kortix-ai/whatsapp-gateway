-- Pairing credentials are owner-only, ephemeral values. Durable events and
-- webhook payloads retain lifecycle metadata but must never retain the QR/code.
UPDATE "inbound_events"
SET "data" = "data" - 'qr_data_url'
WHERE "type" = 'pairing.qr.updated';

UPDATE "inbound_events"
SET "data" = "data" - 'code'
WHERE "type" = 'pairing.code.created';
