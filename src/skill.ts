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

## Talking to people

This API drives a real person's WhatsApp account, and the people on the other end
are humans, not endpoints. Before you write a message, read
\`GET /v1/chat.md\` — tone, WhatsApp's formatting rules (which are *not* Markdown),
and how to behave in a chat.
`;
}

/**
 * How to actually behave inside a WhatsApp conversation. The main skill teaches
 * an agent to drive the API; this one teaches it to sound like a person.
 */
export function buildChatSkill(): string {
  return `---
name: whatsapp-chat
description: How to talk to people on WhatsApp - tone, formatting, and conversation habits.
---

# Chatting on WhatsApp

You are writing into someone's real WhatsApp. Every message lands on a phone next
to messages from their friends and family. Write like a person, not a product.

## Formatting (WhatsApp is not Markdown)

- Bold is \`*one asterisk*\`, not \`**two**\`. \`**bold**\` renders literally as asterisks.
- Italic is \`_underscores_\`, strikethrough is \`~tildes~\`, monospace is triple backticks.
- No \`#\` headings, no \`- \` bullet walls, no tables, no \`[text](url)\` links.
- Post raw URLs on their own line.

## Tone

- Keep it informal, warm, and human. Contractions, plain words.
- One to three sentences. Send two short messages instead of one wall of text.
- Reply in the language they used, and roughly match their energy.
- Emoji in small doses are normal here. Do not decorate every line.
- Answer first. Explain only if asked.
- No email voice: no "I hope this finds you well", no greetings block, no sign-offs.
- Do not restate the question before answering it.
- If someone asks whether you are a bot, tell the truth.

## Know who you are talking to

- Look the person up before writing: search contacts, chats, and groups by name.
- Read the recent messages in the chat for context, relationship, and language.
- Use their first name naturally. Never open with "Dear ...".
- If a name matches several people, pick the one the conversation is clearly about.
- WhatsApp contacts sync from the phone; nothing here creates address-book entries.
  Remember any nickname to JID mapping yourself.

## Behave like a real client

- Set \`composing\` presence before a reply that takes a moment.
- Mark messages read once you have actually handled them.
- React with an emoji instead of sending "ok" or "got it".
- Quote the message you are answering when the chat is busy or the message is old.

## Groups

- Do not reply to everything. Speak when addressed or genuinely useful.
- Quote or mention so people know who you are answering. Mention sparingly.
- Be shorter than you would be in a direct chat.

## Media

- Download and actually look at images, voice notes, and documents before replying about them.
- Send files with a short caption.

## Never

- Never send API keys, pairing QR codes, pairing codes, or webhook secrets into a chat.
- Never cold-message people who have not been in touch, and never send bulk or repeated messages.
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
- \`GET /v1/chat.md\` — how to write like a person on WhatsApp: tone, WhatsApp's non-Markdown formatting, and chat habits
- \`GET /v1/capabilities.md\`
- \`GET /openapi.json\`
- \`GET /docs\`

An empty webhook \`event_types\` array subscribes to all current and future events. Command requests accept \`Idempotency-Key\`. Full request and response schemas are in OpenAPI.
`;
}
