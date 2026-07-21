# Security Policy

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability involving authentication, API-key scope, Baileys credentials, Signal keys, webhook signing, SSRF, tenant isolation, or secret disclosure.

Use GitHub's private vulnerability reporting for `kortix-ai/whatsapp-gateway`. Include affected versions, deployment assumptions, reproduction steps, impact, and any proposed mitigation. Do not include real WhatsApp credentials, pairing QR data, API keys, webhook secrets, or user message content.

## Operator responsibilities

- Generate unique production values for `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`, and the PostgreSQL password.
- Keep private signup allowlisting enabled unless open signup is intentional.
- Prefer connection-scoped keys for agents and revoke unused keys.
- Protect the PostgreSQL database and backups.
- Keep the gateway, Baileys, Node, PostgreSQL, Docker, and host patched.
- Restrict VPS inbound access to the required HTTP/HTTPS and administrative paths.
- Monitor linked-device health and WhatsApp policy compliance.

This project uses an unofficial linked-device protocol and cannot provide a WhatsApp or Meta service-level guarantee.
