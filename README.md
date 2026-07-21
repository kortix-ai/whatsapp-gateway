# WhatsApp Gateway

A browserless, multi-tenant Baileys bridge for agents and developers. Connect existing WhatsApp accounts through Linked Devices, then control messages, groups, contacts, chats, webhooks, and agent access through one authenticated API.

## Architecture

One TypeScript codebase builds four deployment roles from the same image:

- `api`: Hono REST API, Better Auth, OpenAPI, and the React console.
- `worker`: horizontally scalable Baileys WebSocket sessions with one renewable PostgreSQL lease per number.
- `webhooks`: signed at-least-once delivery, retry, dead-letter, and replay.
- `migrate`: Prisma migrations before rollout.

PostgreSQL is the durable source of truth. Prisma is used for Better Auth and every gateway table and transaction. Baileys credentials and Signal keys are encrypted individually with AES-256-GCM; API keys are scoped, revocable, rate-limited, and hashed by Better Auth.

This release links already-registered WhatsApp accounts. Buying a number and registering a fresh WhatsApp account is intentionally a future provider boundary.

## Run locally

```bash
cp .env.example .env
openssl rand -base64 32
openssl rand -base64 48
```

Put the first result in `ENCRYPTION_KEY` and the second in `BETTER_AUTH_SECRET`, then run:

```bash
docker compose up --build
```

Open `http://localhost:8080`, create a developer account, add a number, and pair it from WhatsApp → Linked devices. The API schema is at `/openapi.json`; the generic agent skill is at `/v1/skill.md`.

Unfinished QR or phone-code attempts expire after `PAIRING_TTL_SECONDS` (five minutes by default), release their worker lease, and delete their unregistered auth state.

For local source development:

```bash
docker compose up -d postgres
pnpm install
pnpm db:migrate
pnpm dev
```

## Authentication

Browser clients use Better Auth session cookies. Programmatic clients use a Better Auth API key:

```bash
curl -sS http://localhost:8080/v1/accounts \
  -H "X-API-Key: $WHATSAPP_GATEWAY_API_KEY"
```

Create normal developer keys through Better Auth's `/api/auth/api-key/*` routes. `POST /v1/agent-access` creates an account-scoped key plus a personalized `SKILL.md`; its plaintext key is returned exactly once.

Better Auth's legacy MCP provider plugin is not required for REST/API-key access and is being deprecated upstream in favor of its OAuth Provider plugin. This gateway therefore keeps agent access on scoped API keys today; add OAuth-protected MCP transport as a separate surface when a concrete MCP client flow is needed.

## Pair and send

```bash
curl -sS -X POST http://localhost:8080/v1/accounts/$ACCOUNT_ID/pair/qr \
  -H "X-API-Key: $WHATSAPP_GATEWAY_API_KEY" \
  -H 'Content-Type: application/json' -d '{}'

curl -sS -X POST http://localhost:8080/v1/accounts/$ACCOUNT_ID/messages \
  -H "X-API-Key: $WHATSAPP_GATEWAY_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"to":"+15551234567","text":"Hello from the gateway"}'
```

## Webhook verification

The gateway signs `timestamp + "." + raw_body` with HMAC-SHA256. Verify `X-WhatsApp-Signature: v1=<hex>` using the one-time endpoint secret, reject stale timestamps, and deduplicate by `X-WhatsApp-Event-Id`.

Private, loopback, link-local, and metadata-network webhook destinations are blocked by default and rechecked at delivery time. Set `ALLOW_PRIVATE_WEBHOOKS=true` only for local development.

## Full Baileys socket surface

`GET /v1/baileys-actions` returns the managed action catalog, required permission, exact Baileys socket method, argument order, and description. Execute one durably with:

```bash
curl -sS -X POST \
  http://localhost:8080/v1/accounts/$ACCOUNT_ID/actions/privacy.fetch \
  -H "X-API-Key: $WHATSAPP_GATEWAY_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"args":[true]}'
```

The catalog covers the high-level operations on the installed Baileys socket: rich messages and media, receipts and presence, chat mutations and labels, contacts and profiles, blocking and privacy, groups, communities, newsletters/channels, WhatsApp Business catalogs and quick replies, calls, bots, and app-state operations. An exhaustive test requires every callable socket member to be managed, handled by a dedicated route, or explicitly classified as internal. Low-level transport, protocol, retry, and cryptographic primitives such as `sendNode`, `query`, `relayMessage`, raw Signal session mutation, and raw WebSocket writes are deliberately not exposed because they bypass tenant, durability, and cryptographic-state invariants.

## Verification

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm e2e
pnpm smoke:curl
pnpm skill:validate
docker compose build
```

Set `E2E_PAIRING=1` or `SMOKE_PAIRING=1` to include a real Baileys WebSocket and QR-image assertion in the corresponding end-to-end run. The curl smoke performs real signup, account creation, scoped Better Auth API-key mint/use/revoke, action-catalog inspection, optional pairing, and revoked-key rejection without printing credentials.
