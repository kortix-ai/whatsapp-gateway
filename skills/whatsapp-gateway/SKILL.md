---
name: whatsapp-gateway
description: Operate connected WhatsApp accounts through the managed WhatsApp Gateway API. Use when an agent needs to inspect chats or contacts, send WhatsApp messages, create or manage groups, or consume WhatsApp events with a user-provided scoped gateway key.
---

# WhatsApp Gateway

Obtain the gateway base URL and a scoped API key from the user. Set the key as `WHATSAPP_GATEWAY_API_KEY`. Never print, persist, commit, or transmit it anywhere except the gateway.

Authenticate every request with `X-API-Key: $WHATSAPP_GATEWAY_API_KEY`.

## Choose an account

Call `GET /v1/accounts`. Select the account the user named. If multiple accounts match ambiguously, ask before acting.

Read synchronized state when needed:

- Call `GET /v1/accounts/{accountId}/chats` for conversations.
- Call `GET /v1/accounts/{accountId}/contacts` for recipients.
- Call `GET /v1/accounts/{accountId}/groups` for group IDs.
- Call `GET /v1/accounts/{accountId}/messages?chat_jid=...` for message history.

Use `GET /openapi.json` for the complete machine-readable contract or `GET /docs` for its Scalar reference. The custom REST routes are:

- Accounts: `GET|POST /v1/accounts`, `GET /v1/accounts/{accountId}`, `GET /v1/accounts/{accountId}/status`, `POST /v1/accounts/{accountId}/pair/qr`, `POST /v1/accounts/{accountId}/pair/code`, and `DELETE /v1/accounts/{accountId}/session`.
- Data and messaging: `GET /v1/accounts/{accountId}/chats`, `GET /v1/accounts/{accountId}/contacts`, `GET /v1/accounts/{accountId}/groups`, `GET /v1/accounts/{accountId}/messages`, `POST /v1/accounts/{accountId}/messages`, `POST /v1/accounts/{accountId}/groups`, `PATCH /v1/accounts/{accountId}/groups/{groupId}`, `POST /v1/accounts/{accountId}/groups/{groupId}/participants`, and `DELETE /v1/accounts/{accountId}/groups/{groupId}/participants/{participantId}`.
- Baileys passthrough: `GET /v1/baileys-actions` and `POST /v1/accounts/{accountId}/actions/{action}` with `{"args":[...]}`.
- Webhooks: `GET|POST /v1/webhook-endpoints`, `DELETE /v1/webhook-endpoints/{endpointId}`, `GET /v1/webhook-deliveries`, and `POST /v1/webhook-deliveries/{deliveryId}/replay`.
- Bootstrap: `POST /v1/agent-access` and public `GET /v1/skill.md`.

## Send messages

Send text:

```bash
curl -sS "$WHATSAPP_GATEWAY_URL/v1/accounts/$ACCOUNT_ID/messages" \
  -H "X-API-Key: $WHATSAPP_GATEWAY_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"to":"+15551234567","text":"Hello"}'
```

Supply a WhatsApp JID instead of a phone number when one is available. Supply a Baileys-compatible `content` object instead of `text` for supported rich messages.

## Manage groups

Create a group with `POST /v1/accounts/{accountId}/groups` and JSON `{"subject":"Name","participants":["+15551234567"]}`.

Update its subject or description with `PATCH /v1/accounts/{accountId}/groups/{groupId}`. Add, remove, promote, or demote participants with `POST /v1/accounts/{accountId}/groups/{groupId}/participants` and an `action` field.

## Handle durable results

Treat a response containing `{"status":"pending","command_id":"..."}` as accepted asynchronous work. Do not report it as delivered. Poll synchronized state or account status until the requested outcome appears.

For capabilities without a dedicated convenience endpoint, call `GET /v1/baileys-actions`, select the documented action, then call `POST /v1/accounts/{accountId}/actions/{action}` with `{"args":[...]}`. Use this for receipts, presence, chat mutations, privacy, profiles, business catalogs, communities, newsletters, and calls only when the key grants the action's listed permission.

## Apply safety boundaries

- Ask before sending a message, creating a group, changing participants, or disconnecting an account unless the user explicitly requested the action.
- Confirm the exact recipient or group before sending consequential content.
- Never expose API keys, pairing codes, pairing QR codes, or webhook secrets.
- Never use an account outside the key's returned account list or permissions.
