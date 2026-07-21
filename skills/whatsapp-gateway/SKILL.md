---
name: whatsapp-gateway
description: Operate a connected WhatsApp account through a self-hosted, authenticated, durable WhatsApp Gateway API.
---

# WhatsApp Gateway

Obtain the gateway base URL and a connection-scoped API key from the owner. Set them as `WHATSAPP_GATEWAY_URL` and `WHATSAPP_GATEWAY_API_KEY`. Never print, persist, commit, or transmit the key elsewhere.

Authenticate with `X-API-Key: $WHATSAPP_GATEWAY_API_KEY`.

## Discover the contract

1. Read `GET /v1/capabilities.md` for the compact route map.
2. Read `GET /openapi.json` for all REST schemas.
3. Read `GET /v1/baileys-actions` for every managed WhatsApp action, exact Baileys method, ordered arguments, description, and permission.

## Workflow

1. Call `GET /v1/accounts`; a connection-scoped key should return exactly its assigned number.
2. Resolve ambiguous recipients through chats, contacts, groups, and messages.
3. Execute WhatsApp operations with `POST /v1/accounts/{accountId}/actions/{action}` and `{"args":[...]}`.
4. Retry safely with an `Idempotency-Key` header.
5. If the response is pending, poll `GET /v1/commands/{commandId}?wait_seconds=30` until completed or failed.
6. Consume normalized state through `GET /v1/events` or signed webhooks.

Owner-only API key routes are `GET|POST /v1/api-keys` and `DELETE /v1/api-keys/{keyId}`. Account and pairing routes are `GET|POST /v1/accounts`, `GET /v1/accounts/{accountId}`, `GET /v1/accounts/{accountId}/status`, `POST /v1/accounts/{accountId}/pair/qr`, `POST /v1/accounts/{accountId}/pair/code`, and `DELETE /v1/accounts/{accountId}/session`.

Persisted state routes are `GET /v1/accounts/{accountId}/chats`, `GET /v1/accounts/{accountId}/contacts`, `GET /v1/accounts/{accountId}/groups`, `GET /v1/accounts/{accountId}/messages`, and `GET /v1/events`. Durable control routes are `GET /v1/baileys-actions`, `POST /v1/accounts/{accountId}/actions/{action}`, and `GET /v1/commands/{commandId}`.

Convenience mutation aliases are `POST /v1/accounts/{accountId}/messages`, `POST /v1/accounts/{accountId}/groups`, `PATCH /v1/accounts/{accountId}/groups/{groupId}`, `POST /v1/accounts/{accountId}/groups/{groupId}/participants`, and `DELETE /v1/accounts/{accountId}/groups/{groupId}/participants/{participantId}`.

Webhook routes are `GET /v1/webhook-event-types`, `GET|POST /v1/webhook-endpoints`, `GET|PATCH|DELETE /v1/webhook-endpoints/{endpointId}`, `GET /v1/webhook-deliveries`, `GET /v1/webhook-deliveries/{deliveryId}`, and `POST /v1/webhook-deliveries/{deliveryId}/replay`.

Discovery routes are `GET /v1/skill.md`, `GET /v1/capabilities.md`, `GET /openapi.json`, and `GET /docs`.

Ask before sending messages, creating groups, changing participants, or disconnecting unless explicitly requested. Never expose API keys, pairing QR codes, pairing codes, or webhook secrets.
