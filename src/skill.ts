import { config } from './config.js';

export function buildAgentSkill(): string {
  return `---
name: whatsapp-gateway
description: Operate a connected WhatsApp account through the authenticated, durable WhatsApp Gateway API.
---

# WhatsApp Gateway

Use gateway base URL \`${config.PUBLIC_BASE_URL}\`. Obtain a scoped API key from the owner and set it as \`WHATSAPP_GATEWAY_API_KEY\`. Never print, persist, commit, or transmit the key elsewhere.

Authenticate with \`X-API-Key: $WHATSAPP_GATEWAY_API_KEY\`.

## Discover the live contract

1. Read \`GET /v1/capabilities.md\` for a compact route and workflow map.
2. Read \`GET /openapi.json\` for the complete schemas and REST contract.
3. Read \`GET /v1/baileys-actions\` for every managed WhatsApp action, its exact Baileys method, ordered arguments, description, and permission.

## Operating workflow

1. Call \`GET /v1/accounts\` and select the user-named account.
2. Resolve ambiguous recipients using chats, contacts, groups, and messages before acting.
3. Use \`POST /v1/accounts/{accountId}/actions/{action}\` for durable WhatsApp operations.
4. When a response is pending, poll \`GET /v1/commands/{commandId}?wait_seconds=30\` until completed or failed.
5. Consume normalized events through \`GET /v1/events\` or signed webhooks.

Use an \`Idempotency-Key\` header for retryable command requests. Ask before sending messages, creating groups, changing participants, or disconnecting unless the user explicitly requested the action. Never expose API keys, pairing QR codes, pairing codes, or webhook secrets.
`;
}

export function buildAgentCapabilities(): string {
  return `# WhatsApp Gateway capabilities

Base URL: \`${config.PUBLIC_BASE_URL}\`

## Accounts and pairing

- \`GET /v1/accounts\`
- \`POST /v1/accounts\`
- \`GET /v1/accounts/{accountId}\`
- \`GET /v1/accounts/{accountId}/status\`
- \`POST /v1/accounts/{accountId}/pair/qr\`
- \`POST /v1/accounts/{accountId}/pair/code\`
- \`DELETE /v1/accounts/{accountId}/session\`

## API keys (signed-in owner only)

- \`GET /v1/api-keys\`
- \`POST /v1/api-keys\`
- \`DELETE /v1/api-keys/{keyId}\`

Use a connection-scoped key for an agent controlling one WhatsApp number. Account-scoped keys can access every current and future connection owned by the user.

## Persisted WhatsApp state

- \`GET /v1/accounts/{accountId}/chats\`
- \`GET /v1/accounts/{accountId}/contacts\`
- \`GET /v1/accounts/{accountId}/groups\`
- \`GET /v1/accounts/{accountId}/messages\` — add \`q\` to full-text search message text
- \`GET /v1/accounts/{accountId}/messages/{messageId}/media\` — download decrypted image/video/audio/document bytes (add \`?download=1\` to force a file download)
- \`POST /v1/accounts/{accountId}/messages/media\` — send a local file (multipart/form-data: \`to\`, \`file\`, optional \`caption\`/\`kind\`)
- \`POST /v1/accounts/{accountId}/messages/{messageId}/reaction\` — react with an emoji
- \`POST /v1/accounts/{accountId}/messages/{messageId}/read\` — mark a message read
- \`PATCH /v1/accounts/{accountId}/chats/{chatJid}\` — archive, pin, mute, or mark a chat read
- \`POST /v1/accounts/{accountId}/presence\` — broadcast available/composing/recording presence
- \`GET /v1/events\`

## Durable actions

- \`GET /v1/baileys-actions\`
- \`POST /v1/accounts/{accountId}/actions/{action}\`
- \`GET /v1/commands/{commandId}\`

Convenience aliases remain available for message sending and group operations:

- \`POST /v1/accounts/{accountId}/messages\`
- \`POST /v1/accounts/{accountId}/groups\`
- \`PATCH /v1/accounts/{accountId}/groups/{groupId}\`
- \`POST /v1/accounts/{accountId}/groups/{groupId}/participants\`
- \`DELETE /v1/accounts/{accountId}/groups/{groupId}/participants/{participantId}\`

## Webhooks

- \`GET /v1/webhook-event-types\`
- \`GET /v1/webhook-endpoints\`
- \`POST /v1/webhook-endpoints\`
- \`GET /v1/webhook-endpoints/{endpointId}\`
- \`PATCH /v1/webhook-endpoints/{endpointId}\`
- \`DELETE /v1/webhook-endpoints/{endpointId}\`
- \`GET /v1/webhook-deliveries\`
- \`GET /v1/webhook-deliveries/{deliveryId}\`
- \`POST /v1/webhook-deliveries/{deliveryId}/replay\`

## Discovery

- \`GET /v1/skill.md\`
- \`GET /v1/capabilities.md\`
- \`GET /openapi.json\`
- \`GET /docs\`

An empty webhook \`event_types\` array subscribes to all current and future events. Command requests accept \`Idempotency-Key\`. Full request and response schemas are in OpenAPI.
`;
}
