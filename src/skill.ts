import { config } from './config.js';

export function buildAgentSkill(apiKey?: string): string {
  const baseUrl = config.PUBLIC_BASE_URL;
  const auth = apiKey
    ? `Set this credential for the current task:\n\n\`\`\`bash\nexport WHATSAPP_GATEWAY_API_KEY='${apiKey}'\n\`\`\`\n\nDo not print, persist, commit, or transmit it anywhere except the gateway.`
    : 'Obtain a scoped key from the gateway owner and set it as `WHATSAPP_GATEWAY_API_KEY`. Never print or commit it.';
  return `---
name: whatsapp-gateway
description: Operate connected WhatsApp accounts through the managed WhatsApp Gateway API. Use when an agent needs to inspect chats or contacts, send WhatsApp messages, create or manage groups, or consume WhatsApp events with a user-provided scoped gateway key.
---

# WhatsApp Gateway

${auth}

Use API base URL \`${baseUrl}\`. Authenticate every request with \`X-API-Key: $WHATSAPP_GATEWAY_API_KEY\`.

## Workflow

1. List available accounts with \`GET /v1/accounts\` and select an account ID.
2. Read chats, contacts, groups, or messages before acting when the destination is ambiguous.
3. Send text with \`POST /v1/accounts/{accountId}/messages\` and JSON \`{"to":"<phone-or-jid>","text":"<message>"}\`.
4. Send richer Baileys content by supplying \`content\` instead of \`text\` only when the request requires it.
5. Create groups with \`POST /v1/accounts/{accountId}/groups\` and JSON \`{"subject":"...","participants":["+1555..."]}\`.
6. Treat returned command IDs as durable asynchronous work. Poll account messages or status when a command remains pending.

## Complete REST reference

Account and pairing routes:

- \`GET /v1/accounts\` — list accounts accessible to this key.
- \`POST /v1/accounts\` — create a connection with \`{"display_name":"...","phone_number":"optional"}\`.
- \`GET /v1/accounts/{accountId}\` — get one account.
- \`GET /v1/accounts/{accountId}/status\` — get connection state. Pairing secrets require \`accounts:pair\`.
- \`POST /v1/accounts/{accountId}/pair/qr\` with \`{}\` — begin QR linked-device pairing.
- \`POST /v1/accounts/{accountId}/pair/code\` with \`{"phone_number":"+1555..."}\` — request phone pairing code.
- \`DELETE /v1/accounts/{accountId}/session\` — log out and delete the linked-device session.

Synchronized data and messaging routes:

- \`GET /v1/accounts/{accountId}/chats\` — list chats.
- \`GET /v1/accounts/{accountId}/contacts\` — list contacts.
- \`GET /v1/accounts/{accountId}/groups\` — list groups.
- \`GET /v1/accounts/{accountId}/messages?chat_jid=...&before=...&limit=50\` — list messages.
- \`POST /v1/accounts/{accountId}/messages\` — send \`{"to":"phone-or-jid","text":"..."}\` or a Baileys-compatible \`content\` object.
- \`POST /v1/accounts/{accountId}/groups\` — create with \`{"subject":"...","participants":["+1555..."]}\`.
- \`PATCH /v1/accounts/{accountId}/groups/{groupId}\` — update \`subject\` and/or \`description\`.
- \`POST /v1/accounts/{accountId}/groups/{groupId}/participants\` — pass \`participants\` and \`action: add|remove|promote|demote\`.
- \`DELETE /v1/accounts/{accountId}/groups/{groupId}/participants/{participantId}\` — remove one participant.

Complete Baileys passthrough routes:

- \`GET /v1/baileys-actions\` — discover every managed action, exact socket method, ordered arguments, description, and permission.
- \`POST /v1/accounts/{accountId}/actions/{action}\` with \`{"args":[...]}\` — durably execute any discovered action.

Webhook routes:

- \`GET /v1/webhook-endpoints\` — list endpoints.
- \`POST /v1/webhook-endpoints\` — create with \`{"url":"https://...","event_types":[]}\`; an empty list subscribes to every event and the signing secret is returned once.
- \`DELETE /v1/webhook-endpoints/{endpointId}\` — delete an endpoint.
- \`GET /v1/webhook-deliveries\` — inspect delivery, retry, and dead-letter state.
- \`POST /v1/webhook-deliveries/{deliveryId}/replay\` — replay a delivery.

Agent bootstrap routes:

- \`POST /v1/agent-access\` — browser-session-only key and personalized skill minting.
- \`GET /v1/skill.md\` — download this generic skill without authentication.
- \`GET /openapi.json\` and \`GET /docs\` — raw OpenAPI 3.1 and interactive Scalar reference.

Webhook requests contain \`X-WhatsApp-Event-Id\`, \`X-WhatsApp-Delivery-Id\`, \`X-WhatsApp-Timestamp\`, and \`X-WhatsApp-Signature: v1=<hex>\`. Verify HMAC-SHA256 over \`timestamp + "." + raw_body\`, reject stale timestamps, and deduplicate event IDs. A \`message.created\` event is committed with the synchronized message before its delivery is queued.

Ask before sending messages, creating groups, changing participants, or disconnecting an account unless the user explicitly requested that action. Never expose pairing QR codes, pairing codes, webhook secrets, or API keys.
`;
}
