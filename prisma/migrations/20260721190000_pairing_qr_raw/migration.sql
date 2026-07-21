-- Store the raw WhatsApp pairing payload alongside the rendered PNG so CLI and
-- terminal clients can draw the QR code themselves.
ALTER TABLE "whatsapp_accounts" ADD COLUMN "pairingQrRaw" TEXT;
