# WhatsApp Gateway

[![CI](https://github.com/kortix-ai/whatsapp-gateway/actions/workflows/ci.yml/badge.svg)](https://github.com/kortix-ai/whatsapp-gateway/actions/workflows/ci.yml)
[![Container](https://github.com/kortix-ai/whatsapp-gateway/actions/workflows/container.yml/badge.svg)](https://github.com/kortix-ai/whatsapp-gateway/pkgs/container/whatsapp-gateway)
[![License: MIT](https://img.shields.io/badge/license-MIT-black.svg)](LICENSE)

Self-hosted, authenticated, durable [Baileys](https://github.com/WhiskeySockets/Baileys) infrastructure for developers and AI agents.

Connect an existing WhatsApp account through Linked Devices, create an API key scoped to that connection, and operate the account through REST, curl, the `wag` CLI, signed webhooks, or the bundled agent skill.

> This project uses the unofficial WhatsApp Web linked-device protocol through Baileys. It is not affiliated with or endorsed by WhatsApp or Meta. Review WhatsApp’s terms and use automation responsibly.

## What it provides

- Browserless Baileys sessions; no Chrome fleet.
- Multiple WhatsApp connections in one deployment.
- Encrypted PostgreSQL-backed credentials and Signal keys.
- Horizontally scalable workers with one renewable lease per connection.
- Durable WhatsApp commands with idempotency keys and result polling.
- Persisted chats, contacts, groups, messages, unread chat state, and normalized events.
- 119 managed high-level Baileys actions.
- Account-wide and single-connection API keys.
- Email allowlist enabled by default for private deployments.
- Signed at-least-once webhooks with retry, dead letter, replay, and SSRF protection.
- OpenAPI 3.1 and a Scalar API console.
- Installable `wag` CLI and credential-free agent `SKILL.md`.
- Production Docker Compose and Caddy automatic HTTPS for a VPS.

## Architecture

```text
Browser / curl / wag / agent
            │
            ▼
      Caddy HTTPS
            │
            ▼
    Hono API + UI ───────────────┐
            │                    │
            ▼                    ▼
       PostgreSQL          Webhook workers
  auth, keys, messages,      signed delivery
  commands, events, leases
            │
            ▼
      Baileys workers
  ┌─────────┼──────────┐
  ▼         ▼          ▼
number A  number B   number C
socket    socket     socket
```

One phone number is one Baileys WebSocket session, not one container. A worker multiplexes multiple sessions; the default capacity is 25. Add worker replicas to add active-session capacity. PostgreSQL leases ensure only one worker owns each connection.

## Requirements

- An existing WhatsApp account on a phone.
- Docker Engine and Docker Compose v2 for deployment.
- A Linux VPS with ports 80 and 443 open for production HTTPS.
- A DNS A/AAAA record pointing your domain at the VPS.

For source development, use Node `>=22.19` and pnpm `8.11.0`.

## Local quick start

```bash
cp .env.example .env
openssl rand -base64 32  # ENCRYPTION_KEY
openssl rand -base64 48  # BETTER_AUTH_SECRET
```

Put the generated values in `.env`, then:

```bash
docker compose up -d --build --wait
```

Open:

- Console: <http://localhost:8080>
- Scalar API reference: <http://localhost:8080/docs>
- OpenAPI: <http://localhost:8080/openapi.json>
- Agent skill: <http://localhost:8080/v1/skill.md>
- Compact capabilities: <http://localhost:8080/v1/capabilities.md>

Sign up as the allowlisted email, create a connection name, then choose QR or phone-code pairing. In WhatsApp, open **Settings → Linked Devices → Link a Device**.

## Deploy on a VPS with automatic HTTPS

Clone the repository on an Ubuntu/Debian VPS:

```bash
git clone https://github.com/kortix-ai/whatsapp-gateway.git
cd whatsapp-gateway
cp .env.production.example .env
chmod 600 .env
```

Generate secrets:

```bash
openssl rand -base64 32
openssl rand -base64 48
openssl rand -base64 36
```

Use them for `ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`, and `POSTGRES_PASSWORD`. Set:

```dotenv
DOMAIN=whatsapp.example.com
AUTH_ALLOWLIST_ENABLED=true
ALLOWED_EMAILS=marko@kortix.ai
```

The password in `DATABASE_URL` must match `POSTGRES_PASSWORD`. URL-encode special characters or generate a URL-safe password.

Point the domain at the VPS, allow inbound TCP 80/443 and UDP 443, then run:

```bash
./scripts/deploy-vps.sh
```

The production stack:

- Keeps PostgreSQL private inside the Compose network.
- Runs Prisma migrations before application services.
- Runs the API, Baileys worker, and webhook worker independently.
- Uses Caddy for automatic TLS certificates and security headers.
- Persists PostgreSQL and Caddy data in named volumes.
- Restarts long-running services automatically.

Upgrade:

```bash
git pull --ff-only
./scripts/deploy-vps.sh
```

Back up at minimum the PostgreSQL volume/database and the production `.env`. Losing `ENCRYPTION_KEY` makes stored WhatsApp auth state unrecoverable.

## Private allowlist authentication

Private mode is the default:

```dotenv
AUTH_ALLOWLIST_ENABLED=true
ALLOWED_EMAILS=marko@kortix.ai
```

Multiple emails are comma-separated:

```dotenv
ALLOWED_EMAILS=marko@kortix.ai,operator@example.com
```

Non-allowlisted users cannot create an account, create a session, or use previously issued API keys.

To run an open signup deployment explicitly:

```dotenv
AUTH_ALLOWLIST_ENABLED=false
```

Do not disable the allowlist on a public server unless you intentionally want a multi-user signup service and have added appropriate quotas, abuse controls, and operational policy.

## API keys

There are two scopes:

- `connection`: restricted to exactly one WhatsApp connection. Recommended for an agent.
- `account`: accesses every current and future connection owned by the user. Intended for trusted administrative tooling.

Keys use the `wag_` prefix, are hashed at rest, rate-limited, permission-aware, expirable, and revocable. The full key is returned once.

Create a connection key from the signed-in console or:

```http
POST /v1/api-keys
Cookie: better-auth session
Content-Type: application/json

{
  "name": "Personal WhatsApp agent",
  "scope": "connection",
  "account_id": "wa_...",
  "expires_in_seconds": null
}
```

Programmatic requests authenticate with:

```bash
export WHATSAPP_GATEWAY_URL=https://whatsapp.example.com
export WHATSAPP_GATEWAY_API_KEY=wag_secret

curl -sS "$WHATSAPP_GATEWAY_URL/v1/accounts" \
  -H "X-API-Key: $WHATSAPP_GATEWAY_API_KEY"
```

Never place an API key in a URL, source file, log, or agent transcript.

## CLI

Build and link the CLI from source:

```bash
pnpm install
pnpm build
npm link
wag help
```

When published to npm it can be installed with:

```bash
npm install -g @kortix/whatsapp-gateway
```

Configure it:

```bash
export WHATSAPP_GATEWAY_URL=https://whatsapp.example.com
export WHATSAPP_GATEWAY_API_KEY=wag_secret
```

Commands:

```bash
wag auth status
wag accounts list
wag accounts status <account>
wag pair qr <account> --output pairing.png
wag pair code <account> --phone +491234567890
wag chats list <account> --unread
wag messages list <account> --chat <jid> --unread
wag messages send <account> --to <phone-or-jid> --text 'Hello'
wag messages read <account> --message <gateway-message-id>
wag groups list <account>
wag groups create <account> --subject Friends --participant +49123 --participant +49456
wag actions list --category privacy
wag actions run <account> privacy.fetch --args '[true]'
wag commands get <command-id> --wait
wag events tail <account> --type message.created
wag webhooks list
```

Add `--json` for compact machine output. `events tail` emits NDJSON. Use `--idempotency-key` when retrying commands.

## Complete managed Baileys API

Discover the installed surface:

```bash
curl -sS "$WHATSAPP_GATEWAY_URL/v1/baileys-actions" \
  -H "X-API-Key: $WHATSAPP_GATEWAY_API_KEY"
```

Execute an action durably:

```bash
curl -sS -X POST \
  "$WHATSAPP_GATEWAY_URL/v1/accounts/$ACCOUNT_ID/actions/messages.send" \
  -H "X-API-Key: $WHATSAPP_GATEWAY_API_KEY" \
  -H "Idempotency-Key: agent-message-001" \
  -H 'Content-Type: application/json' \
  -d '{"args":["491234567890@s.whatsapp.net",{"text":"Hello"}]}'
```

The catalog covers high-level supported operations for:

- Messages, rich content, receipts, history, reactions, and labels.
- Presence, contacts, chats, profiles, privacy, and blocklist.
- Groups and communities.
- Newsletters/channels.
- WhatsApp Business profiles, catalogs, products, orders, and quick replies.
- Supported call, bot, and account/app-state operations.

Low-level transport, protocol, raw Signal mutation, and raw WebSocket operations are intentionally not exposed because they bypass authorization, durability, and cryptographic invariants.

## Persisted reads and unread messages

```bash
wag chats list "$ACCOUNT_ID" --unread
wag messages list "$ACCOUNT_ID" --unread
```

REST filters include:

- Chats: `q`, `unread`, `archived`.
- Contacts/groups: `q`.
- Messages: `chat_jid`, `unread`, `direction`, `status`, `type`, `sender_jid`, `since`, `before`, `limit`.

The gateway stores normalized fields plus the complete JSON-compatible Baileys message payload.

## Durable commands

Commands are stored before execution. If an operation cannot finish within the synchronous request window, the API returns a command ID.

Every mutation returns the same durable envelope with `command_id`, `status`, `result`, `error`, attempt count, idempotency key, and timestamps. Pending/processing work uses HTTP 202; completed or failed terminal work uses HTTP 200 so clients never lose the durable command ID.

```bash
wag commands get cmd_... --wait
```

Or:

```bash
curl -sS "$WHATSAPP_GATEWAY_URL/v1/commands/cmd_...?wait_seconds=30" \
  -H "X-API-Key: $WHATSAPP_GATEWAY_API_KEY"
```

States are `pending`, `processing`, `completed`, and `failed`. Reusing an `Idempotency-Key` with the same command returns the original command; reusing it for different work returns HTTP 409.

## Events and webhooks

Poll normalized durable events:

```bash
wag events tail "$ACCOUNT_ID" --type message.created
```

List all subscribable event types:

```bash
curl -sS "$WHATSAPP_GATEWAY_URL/v1/webhook-event-types" \
  -H "X-API-Key: $WHATSAPP_GATEWAY_API_KEY"
```

Create a webhook with explicit subscriptions:

```json
{
  "url": "https://agent.example.com/webhooks/whatsapp",
  "description": "Agent ingress",
  "account_ids": ["wa_..."],
  "event_types": [
    "message.created",
    "connection.opened",
    "connection.closed",
    "command.failed"
  ]
}
```

An empty `event_types` list means every current and future event. An empty `account_ids` list means every tenant connection. A connection-scoped API key is always forced to its assigned connection and can only see/manage endpoints and deliveries for that connection. The UI requires the user to choose all events intentionally.

### Verify signatures

The signing input is:

```text
timestamp + "." + raw_body
```

Compute HMAC-SHA256 with the one-time endpoint secret and compare it to:

```text
X-WhatsApp-Signature: v1=<hex>
```

Also inspect `X-WhatsApp-Event-Id`, `X-WhatsApp-Delivery-Id`, and `X-WhatsApp-Timestamp`. Reject stale timestamps and deduplicate event IDs.

Webhook destinations are DNS-validated. Public deployments reject loopback, private, link-local, and cloud-metadata networks by default.

## Agent skill

`GET /v1/skill.md` is intentionally credential-free and workflow-oriented. It tells an agent to use:

- `/v1/capabilities.md` for a compact route map.
- `/openapi.json` for exact request/response schemas.
- `/v1/baileys-actions` for the installed action catalog.

Give an agent the generic skill and a connection-scoped key through a secure secret channel.

## Scaling

The default worker capacity is 25 concurrent phone sessions. The formula is approximately:

```text
active capacity = worker replicas × WORKER_CAPACITY
```

Start conservatively, measure actual RAM/CPU/network use, and keep headroom. Production scale also requires PostgreSQL connection planning, message/event retention, metrics, backups, and account-health monitoring.

Baileys protocol compatibility and WhatsApp account policy are operational constraints independent of infrastructure capacity.

## Source development

```bash
docker compose up -d postgres
pnpm install
pnpm db:migrate
pnpm dev
```

Verification:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm skill:validate
pnpm build
SMOKE_PAIRING=1 pnpm smoke:curl
E2E_PAIRING=1 pnpm e2e
docker compose build
```

## Project layout

- `src/api`: Hono routes and OpenAPI.
- `src/auth`: Better Auth, allowlist, API-key authorization.
- `src/baileys`: encrypted auth state, socket lifecycle, managed action registry.
- `src/worker`: PostgreSQL leases and session supervision.
- `src/services`: durable commands/events/tenants.
- `src/webhooks`: URL security and signed delivery.
- `src/web`: current React console.
- `src/cli.ts`: `wag` CLI.
- `prisma`: schema and migrations.
- `skills/whatsapp-gateway`: installable agent skill.
- `deploy`: Caddy production configuration.

## Baileys attribution

This gateway is built on [WhiskeySockets/Baileys](https://github.com/WhiskeySockets/Baileys), a TypeScript library for the WhatsApp Web API. Baileys is a separate upstream project with its own license, maintainers, release cadence, and compatibility considerations.

## License

[MIT](LICENSE)
